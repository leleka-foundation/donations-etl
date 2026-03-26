/**
 * Funraise CSV export Zod schemas.
 *
 * Based on Funraise CSV export format. All fields come as strings from CSV parsing.
 * Required fields: Id, Amount, Transaction Date
 * All other fields are optional.
 */
import { z } from 'zod'

/**
 * Zod schema for a single row in the Funraise CSV export.
 *
 * All fields are strings because CSV parsing returns strings.
 * Transformation to proper types happens in the transformer.
 */
export const FunraiseCsvRowSchema = z.object({
  // === Required Fields ===
  Id: z.string().min(1, 'Id is required'),
  Amount: z.string().min(1, 'Amount is required'),
  'Transaction Date': z.string().min(1, 'Transaction Date is required'),

  // === Donor Information ===
  'Supporter Id': z.string().optional().default(''),
  'First Name': z.string().optional().default(''),
  'Last Name': z.string().optional().default(''),
  'Institution Name': z.string().optional().default(''),
  'Institution Category': z.string().optional().default(''),

  // === Address Fields ===
  Address: z.string().optional().default(''),
  City: z.string().optional().default(''),
  'State/Province': z.string().optional().default(''),
  'Postal Code': z.string().optional().default(''),
  Country: z.string().optional().default(''),

  // === Contact Information ===
  Phone: z.string().optional().default(''),
  Email: z.string().optional().default(''),

  // === Transaction Details ===
  Status: z.string().optional().default('Complete'),
  'Payment Method': z.string().optional().default(''),
  'Card Type': z.string().optional().default(''),
  Currency: z.string().optional().default('USD'),
  'Platform Fee Amount': z.string().optional().default('0'),
  'Platform Fee Percent': z.string().optional().default('0'),
  'Tax Deductible Amount': z.string().optional().default(''),
  'Source Amount': z.string().optional().default(''),

  // === Campaign/Attribution ===
  Form: z.string().optional().default(''),
  'Form Id': z.string().optional().default(''),
  'Campaign Goal Id': z.string().optional().default(''),
  'Campaign Page URL': z.string().optional().default(''),
  'Campaign Page Id': z.string().optional().default(''),
  'UTM Source': z.string().optional().default(''),
  'UTM Medium': z.string().optional().default(''),
  'UTM Content': z.string().optional().default(''),
  'UTM Term': z.string().optional().default(''),
  'UTM Campaign': z.string().optional().default(''),

  // === Dedication/Tribute ===
  Dedication: z.string().optional().default(''),
  'Dedication Email': z.string().optional().default(''),
  'Dedication Name': z.string().optional().default(''),
  'Dedication Type': z.string().optional().default(''),
  'Dedication Message': z.string().optional().default(''),

  // === Recurring ===
  Recurring: z.string().optional().default(''),
  'Recurring Id': z.string().optional().default(''),
  Sequence: z.string().optional().default(''),
  Frequency: z.string().optional().default(''),

  // === Additional Metadata ===
  'Prospecting | Real Estate Value': z.string().optional().default(''),
  'Soft Credit Supporter Id': z.string().optional().default(''),
  'Soft Credit Supporter Name': z.string().optional().default(''),
  'Soft Credit Supporter Email': z.string().optional().default(''),
  'Operations Tip Amount': z.string().optional().default(''),
  Match: z.string().optional().default(''),
  Anonymous: z.string().optional().default(''),
  Comment: z.string().optional().default(''),
  'Expiration Date': z.string().optional().default(''),
  Offline: z.string().optional().default(''),
  'Last Four': z.string().optional().default(''),
  'Gateway Response': z.string().optional().default(''),
  'Gateway Transaction Id': z.string().optional().default(''),
  'Import External Id': z.string().optional().default(''),
  Name: z.string().optional().default(''),
  'Check Number': z.string().optional().default(''),
  Memo: z.string().optional().default(''),
  Note: z.string().optional().default(''),
  Tags: z.string().optional().default(''),
  Allocations: z.string().optional().default(''),
  URL: z.string().optional().default(''),
  'Household Id': z.string().optional().default(''),
  'Household Name': z.string().optional().default(''),
})

export type FunraiseCsvRow = z.infer<typeof FunraiseCsvRowSchema>
