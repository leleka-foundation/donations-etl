/**
 * Wise API HTTP client.
 *
 * Handles authentication and error handling for Wise Banking API.
 * Uses neverthrow Result types for explicit error handling.
 */
import type { ConnectorError } from '@donations-etl/types'
import { createConnectorError } from '@donations-etl/types'
import type { DateTime } from 'luxon'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import { fetchIPv4 } from '../ipv4-fetch'
import type { WiseConfig } from '../types'
import {
  WiseBalancesResponseSchema,
  WiseStatementResponseSchema,
  type WiseBalance,
  type WiseStatementResponse,
} from './schema'

export const WISE_BASE_URL = 'https://api.wise.com'

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
 * Create a ConnectorError for Wise API errors.
 */
function createWiseError(
  message: string,
  statusCode?: number,
  retryable?: boolean,
): ConnectorError {
  const type = getErrorType(statusCode)
  return createConnectorError(type, 'wise', message, {
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
 * Wise API client for fetching balance statements.
 */
export class WiseClient {
  private readonly apiToken: string
  private readonly profileId: number
  private readonly balanceId?: number
  private readonly baseUrl: string

  constructor(config: WiseConfig) {
    this.apiToken = config.apiToken
    this.profileId = config.profileId
    this.balanceId = config.balanceId
    this.baseUrl = config.baseUrl ?? WISE_BASE_URL
  }

  /**
   * Build headers for API requests.
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
    }
  }

  /**
   * Make a GET request to the Wise API.
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
        createWiseError(
          /* istanbul ignore next -- @preserve non-Error thrown values are rare */
          error instanceof Error ? error.message : 'Network request failed',
        ),
    ).andThen((response) => {
      if (!response.ok) {
        // Try to get the error body for better diagnostics
        return ResultAsync.fromPromise(
          response.text(),
          // If text() fails, return error with just statusText
          () =>
            createWiseError(
              `HTTP ${response.status}: ${response.statusText}`,
              response.status,
              isRetryableStatus(response.status),
            ),
        ).andThen((errorBody) => {
          const message = errorBody
            ? `HTTP ${response.status}: ${errorBody}`
            : `HTTP ${response.status}: ${response.statusText}`
          return errAsync(
            createWiseError(
              message,
              response.status,
              isRetryableStatus(response.status),
            ),
          )
        })
      }

      return ResultAsync.fromPromise(response.json(), (error) =>
        createWiseError(
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
            createWiseError(
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
   * Get all balances for the profile.
   *
   * @returns Array of balance accounts (one per currency)
   */
  getBalances(): ResultAsync<WiseBalance[], ConnectorError> {
    return this.request(
      `/v4/profiles/${this.profileId}/balances?types=STANDARD`,
      WiseBalancesResponseSchema,
    )
  }

  /**
   * Get balance statement for a specific balance account.
   *
   * Uses the v1 balance-statements endpoint:
   * GET /v1/profiles/{profileId}/balance-statements/{balanceId}/statement.json
   *
   * @param balanceId The balance account ID to fetch statement for
   * @param from Start date for statement
   * @param to End date for statement
   * @param currency Currency code (e.g., 'EUR', 'USD') - optional filter
   */
  getStatementForBalance(
    balanceId: number,
    from: DateTime,
    to: DateTime,
    currency?: string,
  ): ResultAsync<WiseStatementResponse, ConnectorError> {
    // Wise API requires ISO 8601 format in UTC (ending with Z)
    const intervalStart = from.toUTC().toISO()
    const intervalEnd = to.toUTC().toISO()

    // Validate that DateTime conversion succeeded
    if (intervalStart === null || intervalEnd === null) {
      return errAsync(
        createWiseError('Invalid date range: unable to convert to ISO format'),
      )
    }

    const params = new URLSearchParams({
      intervalStart,
      intervalEnd,
      type: 'COMPACT',
    })

    // Currency is optional - if not provided, returns all currencies
    if (currency) {
      params.set('currency', currency)
    }

    return this.request(
      `/v1/profiles/${this.profileId}/balance-statements/${balanceId}/statement.json?${params.toString()}`,
      WiseStatementResponseSchema,
    )
  }

  /**
   * Get balance statement for a date range.
   *
   * Uses the configured balanceId if set, otherwise throws an error.
   * For multi-balance fetching, use getStatementForBalance() directly.
   *
   * @param from Start date for statement
   * @param to End date for statement
   * @param currency Currency code (e.g., 'EUR', 'USD')
   */
  getStatement(
    from: DateTime,
    to: DateTime,
    currency?: string,
  ): ResultAsync<WiseStatementResponse, ConnectorError> {
    if (this.balanceId === undefined) {
      return errAsync(
        createWiseError(
          'balanceId is required when using getStatement() - use getStatementForBalance() for multi-balance fetching',
        ),
      )
    }
    return this.getStatementForBalance(this.balanceId, from, to, currency)
  }

  /**
   * Check if the API is accessible and credentials are valid.
   *
   * Verifies API access by fetching the list of balances for the profile.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.getBalances().map(() => undefined)
  }
}
