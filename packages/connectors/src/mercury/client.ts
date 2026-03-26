/**
 * Mercury API HTTP client.
 *
 * Handles authentication, pagination, and error handling for Mercury Banking API.
 * Uses neverthrow Result types for explicit error handling.
 */
import type { ConnectorError } from '@donations-etl/types'
import { createConnectorError } from '@donations-etl/types'
import type { DateTime } from 'luxon'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import { fetchIPv4 } from '../ipv4-fetch'
import type { MercuryConfig } from '../types'
import {
  MercuryAccountsResponseSchema,
  MercuryTransactionsResponseSchema,
  type MercuryAccountsResponse,
  type MercuryTransactionsResponse,
} from './schema'

export const MERCURY_BASE_URL = 'https://api.mercury.com'
export const MERCURY_DEFAULT_PAGE_SIZE = 100

interface PaginationOptions {
  offset?: number
  limit?: number
}

/**
 * Determine the error type based on status code.
 */
function getErrorType(statusCode?: number): ConnectorError['type'] {
  if (statusCode === 401 || statusCode === 403) return 'auth'
  if (statusCode === 429) return 'rate_limit'
  if (statusCode !== undefined && statusCode >= 400) return 'api'
  return 'network'
}

/**
 * Create a ConnectorError for Mercury API errors.
 */
function createMercuryError(
  message: string,
  statusCode?: number,
  retryable?: boolean,
): ConnectorError {
  const type = getErrorType(statusCode)
  return createConnectorError(type, 'mercury', message, {
    statusCode,
    retryable,
  })
}

/**
 * Determine if an HTTP status code indicates a retryable error.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * Mercury API client for fetching accounts and transactions.
 */
export class MercuryClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: MercuryConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl ?? MERCURY_BASE_URL
  }

  /**
   * Build headers for API requests.
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    }
  }

  /**
   * Make a GET request to the Mercury API.
   */
  private request<T>(
    path: string,
    schema: { parse: (data: unknown) => T },
  ): ResultAsync<T, ConnectorError> {
    const url = `${this.baseUrl}${path}`

    return ResultAsync.fromPromise(
      fetchIPv4(url, {
        method: 'GET',
        headers: this.getHeaders(),
      }),
      (error) =>
        createMercuryError(
          /* istanbul ignore next -- @preserve non-Error thrown values are rare */
          error instanceof Error ? error.message : 'Network request failed',
        ),
    ).andThen((response) => {
      if (!response.ok) {
        return errAsync(
          createMercuryError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            isRetryableStatus(response.status),
          ),
        )
      }

      return ResultAsync.fromPromise(response.json(), (error) =>
        createMercuryError(
          /* istanbul ignore next -- @preserve non-Error thrown values are rare */
          error instanceof Error
            ? error.message
            : 'Failed to parse response JSON',
        ),
      ).andThen((data) => {
        try {
          const parsed = schema.parse(data)
          return okAsync(parsed)
        } catch (error) {
          return errAsync(
            createMercuryError(
              /* istanbul ignore next -- @preserve non-Error thrown values are rare */
              error instanceof Error
                ? `Invalid response: ${error.message}`
                : 'Invalid response format',
            ),
          )
        }
      })
    })
  }

  /**
   * Get all accounts for the authenticated user.
   */
  getAccounts(): ResultAsync<MercuryAccountsResponse, ConnectorError> {
    return this.request('/api/v1/accounts', MercuryAccountsResponseSchema)
  }

  /**
   * Get transactions for a specific account within a date range.
   *
   * @param accountId The Mercury account ID
   * @param from Start date for transactions
   * @param to End date for transactions
   * @param options Pagination options (offset and limit)
   */
  getTransactions(
    accountId: string,
    from: DateTime,
    to: DateTime,
    options: PaginationOptions = {},
  ): ResultAsync<MercuryTransactionsResponse, ConnectorError> {
    const offset = options.offset ?? 0
    const limit = options.limit ?? MERCURY_DEFAULT_PAGE_SIZE

    // Mercury API uses YYYY-MM-DD format for dates
    const startDate = from.toFormat('yyyy-MM-dd')
    const endDate = to.toFormat('yyyy-MM-dd')

    const params = new URLSearchParams({
      start: startDate,
      end: endDate,
      offset: offset.toString(),
      limit: limit.toString(),
    })

    return this.request(
      `/api/v1/account/${accountId}/transactions?${params.toString()}`,
      MercuryTransactionsResponseSchema,
    )
  }

  /**
   * Check if the API is accessible and credentials are valid.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.getAccounts().map(() => undefined)
  }
}
