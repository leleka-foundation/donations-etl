/**
 * Venmo connector implementation.
 *
 * Reads donation transactions from Venmo CSV exports in a directory.
 */
import type { ConnectorError, DonationEvent } from '@donations-etl/types'
import type { ResultAsync } from 'neverthrow'
import pino from 'pino'
import type {
  Connector,
  FetchOptions,
  FetchResult,
  VenmoConfig,
} from '../types'
import { VenmoClient, type IVenmoClient } from './client'
import { transformVenmoRows } from './transformer'

const logger = pino({ name: 'venmo-connector' })

/**
 * Venmo connector for reading CSV exports.
 *
 * Unlike API-based connectors, this reads from local CSV files.
 * All records are returned in a single fetch (no pagination needed).
 */
export class VenmoConnector implements Connector {
  readonly source = 'venmo' as const
  private readonly client: IVenmoClient

  constructor(config: VenmoConfig, client?: IVenmoClient) {
    this.client = client ?? new VenmoClient(config.csvDirPath)
  }

  /**
   * Fetch all donation events from CSV files.
   *
   * Reads all CSV files in the directory and transforms them to DonationEvents.
   * Ignores the date range since we're reading historical exports.
   */
  fetchAll(
    options: FetchOptions,
  ): ResultAsync<DonationEvent[], ConnectorError> {
    logger.info(
      {
        source: this.source,
        from: options.from.toISO(),
        to: options.to.toISO(),
      },
      'Fetching events',
    )

    return this.client.readAllCsvFiles().map((rows) => {
      const events = transformVenmoRows(rows, options.runId)
      logger.info(
        { source: this.source, count: events.length },
        'Fetched events',
      )
      return events
    })
  }

  /**
   * Fetch a page of events (returns all events in single page).
   *
   * CSV files are read all at once, so pagination is not needed.
   */
  fetchPage(options: FetchOptions): ResultAsync<FetchResult, ConnectorError> {
    return this.fetchAll(options).map((events) => ({
      events,
      hasMore: false,
    }))
  }

  /**
   * Check if the CSV directory is accessible.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.client.healthCheck()
  }
}

/**
 * Create a Venmo connector from configuration.
 */
export function createVenmoConnector(
  config: VenmoConfig,
  client?: IVenmoClient,
): VenmoConnector {
  return new VenmoConnector(config, client)
}
