/**
 * Venmo CSV client for reading and parsing CSV exports.
 *
 * Reads all CSV files from a directory and parses them into validated rows.
 * Handles malformed CSV with unescaped newlines in fields.
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
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import { isValidDonation, VenmoCsvRowSchema, type VenmoCsvRow } from './schema'

const logger = pino({ name: 'venmo-client' })

/**
 * Extract error message from unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Convert a Result to ResultAsync.
 */
export function resultToResultAsync<T, E>(
  result: Result<T, E>,
): ResultAsync<T, E> {
  return result.isOk() ? okAsync(result.value) : errAsync(result.error)
}

/**
 * Create a connector error for Venmo.
 */
function createVenmoError(
  type: 'validation' | 'network',
  message: string,
): ConnectorError {
  return createConnectorError(type, 'venmo', message)
}

/**
 * Parse CSV content into validated rows.
 *
 * @param content Raw CSV content
 * @param filename Source filename for error reporting
 * @returns Validated VenmoCsvRow array (only valid donations) or error
 */
export function parseCsvContent(
  content: string,
  filename: string,
): Result<VenmoCsvRow[], ConnectorError> {
  try {
    const records: unknown[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    })

    const validRows: VenmoCsvRow[] = []
    let skipped = 0
    let nonDonations = 0

    for (let i = 0; i < records.length; i++) {
      const record = records[i]

      // Skip rows with empty Transaction ID (summary/footer rows)
      // First validate that it's a valid object with Transaction ID before detailed parsing
      const result = VenmoCsvRowSchema.safeParse(record)

      if (!result.success) {
        skipped++
        logger.warn(
          {
            file: filename,
            row: i + 2,
            errors: result.error.issues,
          },
          'Skipping invalid row',
        )
        continue
      }

      // Only include valid donations (Payment + Complete + positive amount)
      if (!isValidDonation(result.data)) {
        nonDonations++
        continue
      }

      validRows.push(result.data)
    }

    if (skipped > 0 || nonDonations > 0) {
      logger.info(
        { file: filename, valid: validRows.length, skipped, nonDonations },
        'CSV parsing completed',
      )
    }

    return ok(validRows)
  } catch (error) {
    return err(
      createVenmoError(
        'validation',
        `Failed to parse CSV ${filename}: ${getErrorMessage(error)}`,
      ),
    )
  }
}

/**
 * Interface for Venmo client to allow dependency injection in tests.
 */
export interface IVenmoClient {
  readAllCsvFiles(): ResultAsync<VenmoCsvRow[], ConnectorError>
  healthCheck(): ResultAsync<void, ConnectorError>
}

/**
 * Venmo CSV client.
 *
 * Reads and parses Venmo CSV exports from a directory.
 */
export class VenmoClient implements IVenmoClient {
  private readonly csvDirPath: string

  constructor(csvDirPath: string) {
    this.csvDirPath = csvDirPath
  }

  /**
   * Check if the CSV directory exists and is readable.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return ResultAsync.fromPromise(stat(this.csvDirPath), (error) =>
      createVenmoError(
        'network',
        `Cannot access CSV directory: ${getErrorMessage(error)}`,
      ),
    ).andThen((stats) => {
      if (!stats.isDirectory()) {
        return errAsync(
          createVenmoError(
            'validation',
            `Path is not a directory: ${this.csvDirPath}`,
          ),
        )
      }
      return okAsync(undefined)
    })
  }

  /**
   * Read and parse all CSV files in the directory.
   *
   * @returns All validated CSV rows from all files, or error
   */
  readAllCsvFiles(): ResultAsync<VenmoCsvRow[], ConnectorError> {
    return ResultAsync.fromPromise(readdir(this.csvDirPath), (error) =>
      createVenmoError(
        'network',
        `Failed to read directory: ${getErrorMessage(error)}`,
      ),
    ).andThen((files) => {
      // Filter to only CSV files
      const csvFiles = files.filter((f) => f.toLowerCase().endsWith('.csv'))

      if (csvFiles.length === 0) {
        return okAsync([])
      }

      logger.info(
        { count: csvFiles.length, dir: this.csvDirPath },
        'Found CSV files',
      )

      // Read and parse all CSV files
      const readPromises = csvFiles.map((filename) =>
        this.readSingleCsv(filename),
      )

      return ResultAsync.combine(readPromises).map((results) => results.flat())
    })
  }

  /**
   * Read and parse a single CSV file.
   */
  private readSingleCsv(
    filename: string,
  ): ResultAsync<VenmoCsvRow[], ConnectorError> {
    const filePath = join(this.csvDirPath, filename)

    return ResultAsync.fromPromise(readFile(filePath, 'utf-8'), (error) =>
      createVenmoError(
        'network',
        `Failed to read CSV file ${filename}: ${getErrorMessage(error)}`,
      ),
    ).andThen((content) =>
      resultToResultAsync(parseCsvContent(content, filename)),
    )
  }
}
