/**
 * Wise connector implementation.
 *
 * Implements the Connector interface for Wise Balance Statement API.
 * Fetches deposit transactions and transforms them to DonationEvents.
 */
import type {
  ConnectorError,
  DonationEvent,
  Source,
} from '@donations-etl/types'
import { type ResultAsync, okAsync } from 'neverthrow'
import pino from 'pino'
import type { Connector, FetchOptions, FetchResult, WiseConfig } from '../types'
import { WiseClient } from './client'
import { transformWiseTransactions } from './transformer'

const logger = pino({ name: 'wise-connector' })

/**
 * Interface for Wise client to allow dependency injection in tests.
 */
export interface IWiseClient {
  getBalances(): ReturnType<WiseClient['getBalances']>
  getStatementForBalance(
    ...args: Parameters<WiseClient['getStatementForBalance']>
  ): ReturnType<WiseClient['getStatementForBalance']>
  healthCheck(): ReturnType<WiseClient['healthCheck']>
}

/**
 * Options for WiseConnector.
 */
export interface WiseConnectorOptions {
  config: WiseConfig
  client?: IWiseClient // Optional for dependency injection in tests
  /** Currency to filter statements (e.g., 'EUR', 'USD'). If not set, includes all currencies. */
  currency?: string
}

/**
 * Wise connector.
 *
 * Fetches deposit transactions from Wise balance statements and transforms them
 * to canonical DonationEvent format. Only CREDIT + DEPOSIT transactions are
 * included by default (incoming payments/donations).
 */
export class WiseConnector implements Connector {
  readonly source: Source = 'wise'
  private readonly client: IWiseClient
  private readonly currency?: string

  constructor(options: WiseConnectorOptions) {
    /* istanbul ignore next -- @preserve tests always provide mock client */
    this.client = options.client ?? new WiseClient(options.config)
    this.currency = options.currency
  }

  /**
   * Check if the Wise API is accessible.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.client.healthCheck()
  }

  /**
   * Fetch a single page of donation events.
   *
   * Fetches statements from all balance accounts and combines results.
   * No pagination - all events are returned in a single page.
   */
  fetchPage(
    options: FetchOptions,
    _cursor?: string,
  ): ResultAsync<FetchResult, ConnectorError> {
    const { from, to, runId } = options

    logger.info(
      {
        source: this.source,
        from: from.toISO(),
        to: to.toISO(),
        currency: this.currency,
      },
      'Fetching events from all balances',
    )

    // First get all balances for the profile
    return this.client.getBalances().andThen((balances) => {
      logger.info(
        {
          source: this.source,
          balanceCount: balances.length,
          currencies: balances.map((b) => b.currency),
        },
        'Found balances',
      )

      // Fetch statements from each balance sequentially
      // (Could be parallelized, but sequential is safer for rate limits)
      let allEvents: DonationEvent[] = []
      let totalTransactions = 0

      // Use reduce to chain ResultAsync operations
      const fetchAllBalances = balances.reduce(
        (chain, balance) =>
          chain.andThen(() =>
            this.client
              .getStatementForBalance(balance.id, from, to, this.currency)
              .andThen((response) => {
                const events = transformWiseTransactions(
                  response.transactions,
                  runId,
                )
                allEvents = [...allEvents, ...events]
                totalTransactions += response.transactions.length

                logger.debug(
                  {
                    source: this.source,
                    balanceId: balance.id,
                    currency: balance.currency,
                    deposits: events.length,
                    transactions: response.transactions.length,
                  },
                  'Fetched balance statement',
                )

                return okAsync(undefined)
              }),
          ),
        okAsync<void, ConnectorError>(undefined),
      )

      return fetchAllBalances.andThen(() => {
        logger.info(
          {
            source: this.source,
            count: allEvents.length,
            totalTransactions,
            balanceCount: balances.length,
          },
          'Fetched events from all balances',
        )

        return okAsync({ events: allEvents, hasMore: false })
      })
    })
  }

  /**
   * Fetch all donation events for the date range.
   *
   * Since Wise returns all transactions in one request (no pagination),
   * this just delegates to fetchPage.
   */
  fetchAll(
    options: FetchOptions,
  ): ResultAsync<DonationEvent[], ConnectorError> {
    return this.fetchPage(options).map((result) => result.events)
  }
}
