/**
 * Zod schemas for Google Sheets check deposits data.
 *
 * Validates rows from the check deposits spreadsheet.
 */
import { z } from 'zod'

/**
 * Raw row from Google Sheets.
 *
 * Headers: check_number, check_date, deposit_date, payer_name, donor_name, amount,
 *          donor_email, donor_address, bank_contact_info, file_name
 *
 * Unique key: payer_name + check_number
 */
export const CheckDepositRowSchema = z.object({
  // Required fields
  check_number: z.string().min(1, 'check_number is required'),
  check_date: z.string().min(1, 'check_date is required'),
  deposit_date: z.string().min(1, 'deposit_date is required'),
  payer_name: z.string().min(1, 'payer_name is required'),
  donor_name: z.string().min(1, 'donor_name is required'),
  amount: z.string().min(1, 'amount is required'), // "$2,000" format - needs parsing
  // Optional fields
  donor_email: z.string().default(''),
  donor_address: z.string().default(''),
  bank_contact_info: z.string().default(''),
  file_name: z.string().default(''), // Source file for traceability
})

export type CheckDepositRow = z.infer<typeof CheckDepositRowSchema>

/**
 * Configuration for the check deposits connector.
 */
export const CheckDepositsConfigSchema = z.object({
  spreadsheetId: z.string().min(1, 'spreadsheetId is required'),
  sheetName: z.string().default('checks'),
})

export type CheckDepositsConfig = z.infer<typeof CheckDepositsConfigSchema>
