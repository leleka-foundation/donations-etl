/**
 * Givebutter connector implementation.
 *
 * Implements the Connector interface for Givebutter Transactions API.
 * Fetches transactions and transforms them to DonationEvents.
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
  GivebutterConfig,
} from '../types'
import { GIVEBUTTER_DEFAULT_PAGE_SIZE, GivebutterClient } from './client'
import { transformGivebutterTransactions } from './transformer'

/**
 * Zod schema for cursor validation.
 */
const PaginationCursorSchema = z.object({
  page: z.number().int().min(1),
})

type PaginationCursor = z.infer<typeof PaginationCursorSchema>

const DEFAULT_CURSOR: PaginationCursor = { page: 1 }

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
 * Interface for Givebutter client to allow dependency injection in tests.
 */
export interface IGivebutterClient {
  getTransactions(
    ...args: Parameters<GivebutterClient['getTransactions']>
  ): ReturnType<GivebutterClient['getTransactions']>
  healthCheck(): ReturnType<GivebutterClient['healthCheck']>
}

/**
 * Options for GivebutterConnector.
 */
export interface GivebutterConnectorOptions {
  config: GivebutterConfig
  client?: IGivebutterClient // Optional for dependency injection in tests
}

/**
 * Givebutter connector.
 *
 * Fetches transactions from Givebutter Transactions API and transforms them
 * to canonical DonationEvent format. Only includes succeeded transactions
 * by default since those represent completed donations.
 */
export class GivebutterConnector implements Connector {
  readonly source: Source = 'givebutter'
  private readonly client: IGivebutterClient

  constructor(options: GivebutterConnectorOptions) {
    this.client = options.client ?? new GivebutterClient(options.config)
  }

  /**
   * Check if the Givebutter API is accessible.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.client.healthCheck()
  }

  /**
   * Fetch a single page of donation events.
   *
   * Uses page-based pagination (Givebutter's API pattern).
   */
  fetchPage(
    options: FetchOptions,
    cursor?: string,
  ): ResultAsync<FetchResult, ConnectorError> {
    const { from, to, runId } = options
    const paginationState = parseCursor(cursor)

    return this.client
      .getTransactions(from, to, {
        page: paginationState.page,
        perPage: GIVEBUTTER_DEFAULT_PAGE_SIZE,
      })
      .andThen((response) => {
        // Transform only succeeded transactions to donation events
        const events = transformGivebutterTransactions(
          response.data,
          runId,
          false,
        )

        // Determine if there are more pages
        const currentPage = response.meta.current_page
        const lastPage = response.meta.last_page
        const hasMore = currentPage < lastPage

        let nextCursor: string | undefined
        if (hasMore) {
          nextCursor = JSON.stringify({ page: currentPage + 1 })
        }

        return okAsync({ events, hasMore, nextCursor })
      })
  }

  /**
   * Fetch all donation events.
   *
   * Iterates through all pages, accumulating all donation events.
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
