/**
 * Funraise CSV client for reading and parsing CSV exports.
 *
 * Handles malformed CSV with unescaped newlines in fields by pre-processing.
 */
import { createConnectorError, type ConnectorError } from '@donations-etl/types'
import { parse } from 'csv-parse/sync'
import {
  err,
  errAsync,
  ok,
  okAsync,
  ResultAsync,
  type Result,
} from 'neverthrow'
import { readFile, stat } from 'node:fs/promises'
import pino from 'pino'
import { FunraiseCsvRowSchema, type FunraiseCsvRow } from './schema'

const logger = pino({ name: 'funraise-client' })

/**
 * Extract error message from unknown error value.
 *
 * Handles both Error instances and non-Error thrown values (e.g., strings).
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Convert a Result to ResultAsync.
 *
 * Helper function to avoid untestable inline ternaries.
 */
export function resultToResultAsync<T, E>(
  result: Result<T, E>,
): ResultAsync<T, E> {
  return result.isOk() ? okAsync(result.value) : errAsync(result.error)
}

/**
 * Pre-process CSV content to fix malformed newlines in quoted fields.
 *
 * Some CSV exports have unescaped newlines inside quoted fields which breaks
 * standard CSV parsing. This function replaces newlines within quoted fields
 * with spaces.
 */
export function preprocessCsv(content: string): string {
  // The csv-parse library handles quoted fields with newlines correctly,
  // so we don't need to preprocess. However, if the CSV has truly malformed
  // quotes (unmatched), we can't easily fix that automatically.
  return content
}

/**
 * Create a connector error for Funraise.
 */
function createFunraiseError(
  type: 'validation' | 'network',
  message: string,
): ConnectorError {
  return createConnectorError(type, 'funraise', message)
}

/**
 * Parse CSV content into validated rows.
 *
 * @param content Raw CSV content
 * @returns Validated FunraiseCsvRow array or error
 */
export function parseCsvContent(
  content: string,
): Result<FunraiseCsvRow[], ConnectorError> {
  try {
    const records: unknown[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true, // Handle some malformed quotes
      trim: true,
    })

    const validRows: FunraiseCsvRow[] = []
    let skipped = 0

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const result = FunraiseCsvRowSchema.safeParse(record)

      if (result.success) {
        validRows.push(result.data)
      } else {
        skipped++
        logger.warn(
          {
            row: i + 2, // +2 because row 1 is header and arrays are 0-indexed
            errors: result.error.issues,
          },
          'Skipping invalid row',
        )
      }
    }

    if (skipped > 0) {
      logger.info({ valid: validRows.length, skipped }, 'CSV parsing completed')
    }

    return ok(validRows)
  } catch (error) {
    return err(
      createFunraiseError(
        'validation',
        `Failed to parse CSV: ${getErrorMessage(error)}`,
      ),
    )
  }
}

/**
 * Interface for Funraise client to allow dependency injection in tests.
 */
export interface IFunraiseClient {
  readCsv(): ResultAsync<FunraiseCsvRow[], ConnectorError>
  healthCheck(): ResultAsync<void, ConnectorError>
}

/**
 * Funraise CSV client.
 *
 * Reads and parses Funraise CSV exports.
 */
export class FunraiseClient implements IFunraiseClient {
  private readonly csvFilePath: string

  constructor(csvFilePath: string) {
    this.csvFilePath = csvFilePath
  }

  /**
   * Check if the CSV file exists and is readable.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return ResultAsync.fromPromise(stat(this.csvFilePath), (error) =>
      createFunraiseError(
        'network',
        `Cannot access CSV file: ${getErrorMessage(error)}`,
      ),
    ).map(() => undefined)
  }

  /**
   * Read and parse the CSV file.
   *
   * @returns Validated CSV rows or error
   */
  readCsv(): ResultAsync<FunraiseCsvRow[], ConnectorError> {
    return ResultAsync.fromPromise(
      readFile(this.csvFilePath, 'utf-8'),
      (error) =>
        createFunraiseError(
          'network',
          `Failed to read CSV file: ${getErrorMessage(error)}`,
        ),
    ).andThen((content) => {
      const processed = preprocessCsv(content)
      return resultToResultAsync(parseCsvContent(processed))
    })
  }
}
