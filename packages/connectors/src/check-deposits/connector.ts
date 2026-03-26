/**
 * Check Deposits connector implementation.
 *
 * Reads donation data from a Google Sheets spreadsheet.
 * Full reload every time - no incremental logic (date range is ignored).
 */
import type {
  ConnectorError,
  DonationEvent,
  Source,
} from '@donations-etl/types'
import type { ResultAsync } from 'neverthrow'

import type {
  CheckDepositsConfig,
  Connector,
  FetchOptions,
  FetchResult,
} from '../types'
import { CheckDepositsClient } from './client'
import { transformCheckDepositRows } from './transformer'

/**
 * Interface for dependency injection in tests.
 */
export interface ICheckDepositsClient {
  getRows(): ReturnType<CheckDepositsClient['getRows']>
  healthCheck(): ReturnType<CheckDepositsClient['healthCheck']>
}

/**
 * Options for CheckDepositsConnector.
 */
export interface CheckDepositsConnectorOptions {
  config: CheckDepositsConfig
  client?: ICheckDepositsClient
}

/**
 * Check deposits connector.
 *
 * Reads all rows from Google Sheets on every fetch (full reload).
 * Date range filtering is ignored since we always want all historical data.
 */
export class CheckDepositsConnector implements Connector {
  readonly source: Source = 'check_deposits'
  private readonly client: ICheckDepositsClient

  constructor(options: CheckDepositsConnectorOptions) {
    this.client = options.client ?? new CheckDepositsClient(options.config)
  }

  /**
   * Health check.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.client.healthCheck()
  }

  /**
   * Fetch a single page.
   *
   * For check deposits, we always return ALL rows in one page.
   * There's no pagination - it's a full reload every time.
   * The date range (from/to) is ignored.
   */
  fetchPage(
    options: FetchOptions,
    _cursor?: string,
  ): ResultAsync<FetchResult, ConnectorError> {
    const { runId } = options

    return this.client.getRows().map((rows) => {
      const events = transformCheckDepositRows(rows, runId)
      return {
        events,
        hasMore: false, // Always single page
        nextCursor: undefined,
      }
    })
  }

  /**
   * Fetch all events.
   *
   * For check deposits, this is identical to fetchPage since
   * we always do a full reload in a single page.
   */
  fetchAll(
    options: FetchOptions,
  ): ResultAsync<DonationEvent[], ConnectorError> {
    return this.fetchPage(options).map((result) => result.events)
  }
}
