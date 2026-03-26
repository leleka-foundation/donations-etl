/**
 * Mercury connector implementation.
 *
 * Implements the Connector interface for Mercury Banking API.
 * Fetches transactions from all accounts and transforms them to DonationEvents.
 */
import type {
  ConnectorError,
  DonationEvent,
  Source,
} from '@donations-etl/types'
import { type ResultAsync, okAsync } from 'neverthrow'
import { z } from 'zod'
import type {
  Connector,
  FetchOptions,
  FetchResult,
  MercuryConfig,
} from '../types'
import { MERCURY_DEFAULT_PAGE_SIZE, MercuryClient } from './client'
import { transformMercuryTransactions } from './transformer'

/**
 * Zod schema for cursor validation.
 */
const PaginationCursorSchema = z.object({
  accountIndex: z.number().int().min(0),
  offset: z.number().int().min(0),
})

type PaginationCursor = z.infer<typeof PaginationCursorSchema>

const DEFAULT_CURSOR: PaginationCursor = { accountIndex: 0, offset: 0 }

/**
 * Parse a cursor string into pagination state.
 * Returns default cursor if parsing fails.
 */
function parseCursor(cursor?: string): PaginationCursor {
  if (!cursor) {
    return DEFAULT_CURSOR
  }

  try {
    const parsed: unknown = JSON.parse(cursor)
    const result = PaginationCursorSchema.safeParse(parsed)
    if (result.success) {
      return result.data
    }
  } catch {
    // Invalid JSON, return default
  }

  return DEFAULT_CURSOR
}

/**
 * Interface for Mercury client to allow dependency injection in tests.
 */
export interface IMercuryClient {
  getAccounts(): ReturnType<MercuryClient['getAccounts']>
  getTransactions(
    ...args: Parameters<MercuryClient['getTransactions']>
  ): ReturnType<MercuryClient['getTransactions']>
  healthCheck(): ReturnType<MercuryClient['healthCheck']>
}

/**
 * Options for MercuryConnector.
 */
export interface MercuryConnectorOptions {
  config: MercuryConfig
  client?: IMercuryClient // Optional for dependency injection in tests
}

/**
 * Mercury Banking connector.
 *
 * Fetches ALL transactions from all Mercury accounts and transforms them
 * to canonical DonationEvent format. Both credits and debits are included,
 * as well as internal transfers. Filtering (to only include external incoming
 * donations) is applied during the staging-to-final table MERGE.
 */
export class MercuryConnector implements Connector {
  readonly source: Source = 'mercury'
  private readonly client: IMercuryClient

  constructor(options: MercuryConnectorOptions) {
    /* istanbul ignore next -- @preserve tests always provide mock client */
    this.client = options.client ?? new MercuryClient(options.config)
  }

  /**
   * Check if the Mercury API is accessible.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.client.healthCheck()
  }

  /**
   * Fetch a single page of donation events.
   *
   * Paginates through accounts and transactions, returning a cursor
   * for the next page if more data is available.
   */
  fetchPage(
    options: FetchOptions,
    cursor?: string,
  ): ResultAsync<FetchResult, ConnectorError> {
    const { from, to, runId } = options
    const paginationState = parseCursor(cursor)

    return this.client.getAccounts().andThen((accountsResponse) => {
      const accounts = accountsResponse.accounts

      // No accounts = no transactions
      if (accounts.length === 0) {
        return okAsync({ events: [], hasMore: false })
      }

      // Check if we've exhausted all accounts
      if (paginationState.accountIndex >= accounts.length) {
        return okAsync({ events: [], hasMore: false })
      }

      const currentAccount = accounts[paginationState.accountIndex]
      /* istanbul ignore if -- @preserve defensive: index is already bounds-checked above, TypeScript needs the guard */
      if (!currentAccount) {
        return okAsync({ events: [], hasMore: false })
      }

      return this.client
        .getTransactions(currentAccount.id, from, to, {
          offset: paginationState.offset,
          limit: MERCURY_DEFAULT_PAGE_SIZE,
        })
        .andThen((txResponse) => {
          // Transform all transactions for staging (filtering happens at final table load)
          // Pass account name for storage in source_metadata
          const events = transformMercuryTransactions(
            txResponse.transactions,
            runId,
            true, // Include debits in staging
            true, // Include internal transfers in staging
            currentAccount.name,
          )

          // Calculate if there are more transactions in this account
          const fetchedSoFar =
            paginationState.offset + txResponse.transactions.length
          const hasMoreInAccount = fetchedSoFar < txResponse.total

          // Calculate if there are more accounts after this one
          const hasMoreAccounts =
            paginationState.accountIndex + 1 < accounts.length

          const hasMore = hasMoreInAccount || hasMoreAccounts

          let nextCursor: string | undefined
          if (hasMoreInAccount) {
            // More transactions in current account
            nextCursor = JSON.stringify({
              accountIndex: paginationState.accountIndex,
              offset: fetchedSoFar,
            })
          } else if (hasMoreAccounts) {
            // Move to next account
            nextCursor = JSON.stringify({
              accountIndex: paginationState.accountIndex + 1,
              offset: 0,
            })
          }

          return okAsync({ events, hasMore, nextCursor })
        })
    })
  }

  /**
   * Fetch all donation events from all accounts.
   *
   * Iterates through all pages of all accounts, accumulating
   * all donation events.
   */
  fetchAll(
    options: FetchOptions,
  ): ResultAsync<DonationEvent[], ConnectorError> {
    return this.fetchAllRecursive(options, undefined, [])
  }

  /**
   * Recursively fetch all pages.
   */
  private fetchAllRecursive(
    options: FetchOptions,
    cursor: string | undefined,
    accumulated: DonationEvent[],
  ): ResultAsync<DonationEvent[], ConnectorError> {
    return this.fetchPage(options, cursor).andThen((result) => {
      const allEvents = [...accumulated, ...result.events]

      if (!result.hasMore) {
        return okAsync(allEvents)
      }

      return this.fetchAllRecursive(options, result.nextCursor, allEvents)
    })
  }
}
