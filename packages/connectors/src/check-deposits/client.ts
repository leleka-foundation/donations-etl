/**
 * Google Sheets API client for check deposits.
 *
 * Uses google-spreadsheet library with Application Default Credentials (ADC)
 * for authentication. In Cloud Run, this automatically uses the service account.
 * Locally, use `gcloud auth application-default login`.
 */
import type { ConnectorError } from '@donations-etl/types'
import { createConnectorError } from '@donations-etl/types'
import { GoogleAuth } from 'google-auth-library'
import { GoogleSpreadsheet } from 'google-spreadsheet'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import pino from 'pino'

import type { CheckDepositsConfig } from '../types'
import { CheckDepositRowSchema, type CheckDepositRow } from './schema'

/** Logger for check deposits client */
const logger = pino({ name: 'check-deposits-client' })

/** Default sheet name if not specified in config */
export const DEFAULT_SHEET_NAME = 'checks'

/**
 * Determine the error type based on error message.
 */
function getErrorType(message: string): ConnectorError['type'] {
  if (
    message.includes('permission') ||
    message.includes('403') ||
    message.includes('401')
  ) {
    return 'auth'
  }
  if (message.includes('not found')) {
    return 'validation'
  }
  return 'network'
}

/**
 * Create a connector error for check deposits.
 */
function createCheckDepositsError(message: string): ConnectorError {
  const type = getErrorType(message)
  return createConnectorError(type, 'check_deposits', message)
}

/**
 * Google Sheets client for reading check deposit data.
 */
export class CheckDepositsClient {
  private readonly spreadsheetId: string
  private readonly sheetName: string

  constructor(config: CheckDepositsConfig) {
    this.spreadsheetId = config.spreadsheetId
    this.sheetName = config.sheetName ?? DEFAULT_SHEET_NAME
  }

  /**
   * Get all rows from the sheet.
   *
   * Full reload every time - no incremental logic needed since
   * the spreadsheet is small (~130 rows).
   */
  getRows(): ResultAsync<CheckDepositRow[], ConnectorError> {
    return this.loadSpreadsheet().andThen((doc) => this.fetchRowsFromDoc(doc))
  }

  /**
   * Load the spreadsheet and return the document.
   */
  private loadSpreadsheet(): ResultAsync<GoogleSpreadsheet, ConnectorError> {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const doc = new GoogleSpreadsheet(this.spreadsheetId, auth)

    return ResultAsync.fromPromise(doc.loadInfo(), (error) =>
      createCheckDepositsError(
        error instanceof Error ? error.message : 'Failed to load spreadsheet',
      ),
    ).map(() => doc)
  }

  /**
   * Fetch and validate rows from the loaded spreadsheet.
   *
   * Skips rows missing required fields: payer_name, donor_name, check_number, amount.
   * Detects and warns about duplicate payer_name+check_number combinations.
   */
  private fetchRowsFromDoc(
    doc: GoogleSpreadsheet,
  ): ResultAsync<CheckDepositRow[], ConnectorError> {
    const sheet = doc.sheetsByTitle[this.sheetName]
    if (!sheet) {
      return errAsync(
        createCheckDepositsError(
          `Sheet "${this.sheetName}" not found in spreadsheet`,
        ),
      )
    }

    return ResultAsync.fromPromise(sheet.getRows(), (error) =>
      createCheckDepositsError(
        error instanceof Error ? error.message : 'Failed to fetch rows',
      ),
    ).map((rows) => {
      const validatedRows: CheckDepositRow[] = []
      const seenKeys = new Set<string>()

      for (const [rowIndex, row] of rows.entries()) {
        const rowNum = rowIndex + 2 // 1-indexed, plus header row

        const rawRow = {
          check_number: String(row.get('check_number') ?? ''),
          check_date: String(row.get('check_date') ?? ''),
          deposit_date: String(row.get('deposit_date') ?? ''),
          payer_name: String(row.get('payer_name') ?? ''),
          donor_name: String(row.get('donor_name') ?? ''),
          amount: String(row.get('amount') ?? ''),
          donor_email: String(row.get('donor_email') ?? ''),
          donor_address: String(row.get('donor_address') ?? ''),
          bank_contact_info: String(row.get('bank_contact_info') ?? ''),
          file_name: String(row.get('file_name') ?? ''),
        }

        // Skip rows missing required fields
        if (!rawRow.payer_name.trim()) {
          logger.warn({ rowNum }, 'Skipping row: missing payer_name')
          continue
        }
        if (!rawRow.donor_name.trim()) {
          logger.warn(
            { rowNum, payer_name: rawRow.payer_name },
            'Skipping row: missing donor_name',
          )
          continue
        }
        if (!rawRow.check_number.trim()) {
          logger.warn(
            { rowNum, payer_name: rawRow.payer_name },
            'Skipping row: missing check_number',
          )
          continue
        }
        if (!rawRow.amount.trim()) {
          logger.warn(
            {
              rowNum,
              payer_name: rawRow.payer_name,
              check_number: rawRow.check_number,
            },
            'Skipping row: missing amount',
          )
          continue
        }

        // Check for duplicates (payer_name + check_number)
        const uniqueKey = `${rawRow.payer_name}|${rawRow.check_number}`
        if (seenKeys.has(uniqueKey)) {
          logger.warn(
            {
              rowNum,
              payer_name: rawRow.payer_name,
              check_number: rawRow.check_number,
            },
            'Skipping duplicate row: same payer_name and check_number',
          )
          continue
        }
        seenKeys.add(uniqueKey)

        const result = CheckDepositRowSchema.safeParse(rawRow)
        if (result.success) {
          validatedRows.push(result.data)
        } else {
          logger.warn(
            { rowNum, errors: result.error.issues.map((i) => i.message) },
            'Skipping row: validation failed',
          )
        }
      }

      return validatedRows
    })
  }

  /**
   * Health check - verify spreadsheet is accessible.
   */
  healthCheck(): ResultAsync<void, ConnectorError> {
    return this.loadSpreadsheet().andThen((doc) => {
      const sheet = doc.sheetsByTitle[this.sheetName]
      if (!sheet) {
        return errAsync(
          createCheckDepositsError(`Sheet "${this.sheetName}" not found`),
        )
      }
      return okAsync(undefined)
    })
  }
}
