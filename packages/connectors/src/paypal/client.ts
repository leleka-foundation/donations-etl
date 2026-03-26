/**
 * PayPal API HTTP client.
 *
 * Handles OAuth2 authentication and transaction search API calls.
 * Uses neverthrow Result types for explicit error handling.
 */
import { createConnectorError, type ConnectorError } from '@donations-etl/types'
import { DateTime } from 'luxon'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import type { PayPalConfig } from '../types'
import {
  PayPalTokenResponseSchema,
  PayPalTransactionSearchResponseSchema,
  type PayPalTransactionSearchResponse,
} from './schema'

export const PAYPAL_BASE_URL = 'https://api-m.paypal.com'
export const PAYPAL_SANDBOX_URL = 'https://api-m.sandbox.paypal.com'
export const PAYPAL_DEFAULT_PAGE_SIZE = 100

/** PayPal only allows searching transactions from the last 3 years */
export const PAYPAL_HISTORY_YEARS = 3

/**
 * Get the earliest date PayPal allows for transaction searches.
 * PayPal limits searches to the last 3 years. We add a 1-day buffer
 * to account for time-of-day differences in the 3-year calculation.
 */
export function getEarliestAllowedDate(
  now: DateTime = DateTime.utc(),
): DateTime {
  // Add 1 day buffer to ensure we're always safely within the 3-year limit
  return now
    .minus({ years: PAYPAL_HISTORY_YEARS })
    .plus({ days: 1 })
    .startOf('day')
}

interface PaginationOptions {
  page?: number
  pageSize?: number
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
 * Create a ConnectorError for PayPal API errors.
 */
function createPayPalError(
  message: string,
  statusCode?: number,
  retryable?: boolean,
): ConnectorError {
  const type = getErrorType(statusCode)
  return createConnectorError(type, 'paypal', message, {
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
 * PayPal API client for fetching transactions.
 */
export class PayPalClient {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly baseUrl: string
  private accessToken: string | null = null
  private tokenExpiresAt = 0

  constructor(config: PayPalConfig) {
    this.clientId = config.clientId
    this.clientSecret = config.secret
    // baseUrl takes precedence, then sandbox, then production
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl
    } else if (config.sandbox) {
      this.baseUrl = PAYPAL_SANDBOX_URL
    } else {
      this.baseUrl = PAYPAL_BASE_URL
    }
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  private getAccessToken(): ResultAsync<string, ConnectorError> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return okAsync(this.accessToken)
    }

    // Get new token
    return this.refreshToken()
  }

  /**
   * Refresh the OAuth2 access token.
   */
  private refreshToken(): ResultAsync<string, ConnectorError> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64')

    return ResultAsync.fromPromise(
      fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      }),
      (error) =>
        createPayPalError(
          /* istanbul ignore next -- @preserve non-Error thrown values are rare */
          error instanceof Error ? error.message : 'Failed to get access token',
        ),
    ).andThen((response) => {
      if (!response.ok) {
        return errAsync(
          createPayPalError(
            `Token request failed: ${response.status} ${response.statusText}`,
            response.status,
            isRetryableStatus(response.status),
          ),
        )
      }

      return ResultAsync.fromPromise(response.json(), (error) =>
        createPayPalError(
          /* istanbul ignore next -- @preserve non-Error thrown values are rare */
          error instanceof Error
            ? error.message
            : 'Failed to parse token response',
        ),
      ).andThen((data) => {
        try {
          const token = PayPalTokenResponseSchema.parse(data)
          this.accessToken = token.access_token
          // Set expiry with 5 minute buffer
          this.tokenExpiresAt = Date.now() + (token.expires_in - 300) * 1000
          return okAsync(this.accessToken)
        } catch (error) {
          return errAsync(
            createPayPalError(
              /* istanbul ignore next -- @preserve non-Error thrown values are rare */
              error instanceof Error
                ? `Invalid token response: ${error.message}`
                : 'Invalid token response',
            ),
          )
        }
      })
    })
  }

  /**
   * Make an authenticated GET request to the PayPal API.
   */
  private request<T>(
    path: string,
    schema: { parse: (data: unknown) => T },
  ): ResultAsync<T, ConnectorError> {
    return this.getAccessToken().andThen((token) => {
      const url = `${this.baseUrl}${path}`

      return ResultAsync.fromPromise(
        fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }),
        (error) =>
          createPayPalError(
            /* istanbul ignore next -- @preserve non-Error thrown values are rare */
            error instanceof Error ? error.message : 'Network request failed',
          ),
      ).andThen((response) => {
        if (!response.ok) {
          // If unauthorized, clear token and indicate auth error
          if (response.status === 401) {
            this.accessToken = null
            this.tokenExpiresAt = 0
          }

          return errAsync(
            createPayPalError(
              `HTTP ${response.status}: ${response.statusText}`,
              response.status,
              isRetryableStatus(response.status),
            ),
          )
        }

        return ResultAsync.fromPromise(response.json(), (error) =>
          createPayPalError(
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
              createPayPalError(
                /* istanbul ignore next -- @preserve non-Error thrown values are rare */
                error instanceof Error
                  ? `Invalid response: ${error.message}`
                  : 'Invalid response format',
              ),
            )
          }
        })
      })
    })
  }

  /**
   * Search for transactions within a date range.
   *
   * @param from Start date for transactions
   * @param to End date for transactions
   * @param options Pagination options
   */
  getTransactions(
    from: DateTime,
    to: DateTime,
    options: PaginationOptions = {},
  ): ResultAsync<PayPalTransactionSearchResponse, ConnectorError> {
    /* istanbul ignore next -- @preserve pagination defaults rarely both hit */
    const page = options.page ?? 1
    /* istanbul ignore next -- @preserve pagination defaults rarely both hit */
    const pageSize = options.pageSize ?? PAYPAL_DEFAULT_PAGE_SIZE

    // PayPal uses ISO 8601 format
    const startDate = from.toISO()
    const endDate = to.toISO()

    /* istanbul ignore next -- @preserve valid DateTime always returns ISO string */
    const params = new URLSearchParams({
      start_date: startDate ?? '',
      end_date: endDate ?? '',
      page_size: pageSize.toString(),
      page: page.toString(),
      fields: 'all', // Include all fields (transaction_info, payer_info, etc.)
    })

    return this.request(
      `/v1/reporting/transactions?${params.toString()}`,
      PayPalTransactionSearchResponseSchema,
    )
  }

  /**
   * Check if the API is accessible and credentials are valid.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.getAccessToken().map(() => undefined)
  }

  /**
   * Clear cached access token (useful for testing).
   */
  clearTokenCache(): void {
    this.accessToken = null
    this.tokenExpiresAt = 0
  }
}
