/**
 * Funraise connector implementation.
 *
 * Implements the Connector interface for Funraise CSV exports.
 * Reads CSV files and transforms rows to DonationEvents.
 */
import type {
  ConnectorError,
  DonationEvent,
  Source,
} from '@donations-etl/types'
import { okAsync, type ResultAsync } from 'neverthrow'
import type {
  Connector,
  FetchOptions,
  FetchResult,
  FunraiseConfig,
} from '../types'
import { FunraiseClient, type IFunraiseClient } from './client'
import { transformFunraiseRows } from './transformer'

/**
 * Options for FunraiseConnector.
 */
export interface FunraiseConnectorOptions {
  config: FunraiseConfig
  client?: IFunraiseClient // Optional for dependency injection in tests
}

/**
 * Funraise CSV connector.
 *
 * Reads Funraise CSV exports and transforms them to canonical DonationEvent format.
 * Since CSV is a file-based source, there's no pagination - all data is read at once.
 */
export class FunraiseConnector implements Connector {
  readonly source: Source = 'funraise'
  private readonly client: IFunraiseClient

  constructor(options: FunraiseConnectorOptions) {
    /* istanbul ignore next -- @preserve tests always provide mock client */
    this.client =
      options.client ?? new FunraiseClient(options.config.csvFilePath)
  }

  /**
   * Check if the CSV file exists and is readable.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.client.healthCheck()
  }

  /**
   * Fetch a single page of donation events.
   *
   * For CSV files, we return all events in a single page (no pagination).
   */
  fetchPage(
    options: FetchOptions,
    _cursor?: string,
  ): ResultAsync<FetchResult, ConnectorError> {
    const { runId } = options

    return this.client.readCsv().andThen((rows) => {
      const events = transformFunraiseRows(rows, runId)

      // CSV has no pagination - return all events in a single page
      return okAsync({
        events,
        hasMore: false,
      })
    })
  }

  /**
   * Fetch all donation events from the CSV file.
   *
   * For CSV files, this is the same as fetchPage - all data is read at once.
   */
  fetchAll(
    options: FetchOptions,
  ): ResultAsync<DonationEvent[], ConnectorError> {
    return this.fetchPage(options).map((result) => result.events)
  }
}
