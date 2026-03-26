/**
 * Zod schema for Venmo CSV row validation.
 *
 * Venmo exports have 24 columns with transaction data.
 * Rows with empty Transaction ID are summary/footer rows and should be skipped.
 */
import { z } from 'zod'

/**
 * Venmo CSV row schema.
 *
 * Required fields:
 * - Transaction ID: Unique identifier (triple-quoted in CSV)
 * - Date: Transaction date (MM/DD/YYYY)
 * - Time (UTC): Transaction time (HH:MM:SS)
 * - Type: Transaction type (Payment, Standard Transfer)
 * - Status: Transaction status (Complete, Issued)
 * - Amount (total): Total amount with +/- prefix
 *
 * Optional fields have defaults for when they're empty or "(None)".
 */
export const VenmoCsvRowSchema = z.object({
  // Required fields
  'Transaction ID': z.string().min(1, 'Transaction ID is required'),
  Date: z.string().min(1, 'Date is required'),
  'Time (UTC)': z.string().min(1, 'Time is required'),
  Type: z.string().min(1, 'Type is required'),
  Status: z.string().min(1, 'Status is required'),
  'Amount (total)': z.string().min(1, 'Amount is required'),

  // Optional fields with defaults
  Note: z.string().default(''),
  From: z.string().default(''),
  'Donor email': z.string().default(''),
  To: z.string().default(''),
  'Amount (tip)': z.string().default('0'),
  'Amount (tax)': z.string().default('0'),
  'Amount (net)': z.string().default(''),
  'Amount (fee)': z.string().default('0'),
  'Tax Rate': z.string().default('0'),
  'Tax Exempt': z.string().default(''),
  'Funding Source': z.string().default(''),
  Destination: z.string().default(''),
  'Beginning Balance': z.string().default('0'),
  'Ending Balance': z.string().default('0'),
  'Statement Period Venmo Fees': z.string().default('0'),
  'Terminal Location': z.string().default(''),
  'Year to Date Venmo Fees': z.string().default('0'),
  Disclaimer: z.string().default(''),
})

export type VenmoCsvRow = z.infer<typeof VenmoCsvRowSchema>

/**
 * Check if a row is a valid donation transaction.
 *
 * Valid transactions:
 * - Have Type = "Payment" (not "Standard Transfer")
 * - Have Status = "Complete"
 * - Have positive amounts (start with "+")
 */
export function isValidDonation(row: VenmoCsvRow): boolean {
  return (
    row.Type === 'Payment' &&
    row.Status === 'Complete' &&
    row['Amount (total)'].startsWith('+')
  )
}

/**
 * Strip triple quotes from Transaction ID.
 *
 * Venmo wraps transaction IDs in triple quotes: """4235629069058725679"""
 */
export function stripTransactionIdQuotes(transactionId: string): string {
  return transactionId.replace(/^"+|"+$/g, '')
}
