/**
 * Types and Zod schemas for the donor letter system.
 */
import { z } from 'zod'

/**
 * A single donation row as returned from BigQuery.
 */
export const DonationRowSchema = z.object({
  event_ts: z.object({ value: z.string() }),
  amount: z.number(),
  currency: z.string().length(3),
  source: z.string(),
  status: z.string(),
  donor_name: z.string().nullable(),
  donor_email: z.string().nullable(),
})

export type DonationRow = z.infer<typeof DonationRowSchema>

/**
 * Request parameters for generating a donor letter.
 */
export const LetterRequestSchema = z.object({
  emails: z.array(z.email()).min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['pdf', 'html']).default('pdf'),
  signerName: z.string().optional(),
  signerTitle: z.string().optional(),
})

export type LetterRequest = z.infer<typeof LetterRequestSchema>

/**
 * A processed donation for display in the letter.
 */
export interface LetterDonation {
  index: number
  date: string
  amount: number
  currency: string
  year: number
}

/**
 * Currency-specific total.
 */
export interface CurrencyTotal {
  currency: string
  total: number
  count: number
}

/**
 * Year group with donations and totals.
 */
export interface YearGroup {
  year: number
  donations: LetterDonation[]
  totals: CurrencyTotal[]
}

/**
 * Fully processed data ready for HTML template rendering.
 */
export interface LetterData {
  donorName: string
  date: string
  yearGroups: YearGroup[]
  grandTotals: CurrencyTotal[]
  totalCount: number
  signerName: string
  signerTitle: string
  orgName: string
  orgAddress: string
  orgMission: string
  orgTaxStatus: string
}

export const DEFAULT_SIGNER_NAME = 'Organization Leader'
export const DEFAULT_SIGNER_TITLE = 'Director'
export const DEFAULT_ORG_NAME = 'Your Organization'
export const DEFAULT_ORG_ADDRESS = ''
export const DEFAULT_ORG_MISSION =
  'Our organization is dedicated to making a positive impact through charitable giving.'
export const DEFAULT_ORG_TAX_STATUS =
  'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.'

/**
 * Options for letter generation.
 */
export interface LetterOptions {
  letterDate?: string
  signerName?: string
  signerTitle?: string
  orgName?: string
  orgAddress?: string
  orgMission?: string
  orgTaxStatus?: string
}

/**
 * Error types for letter generation operations.
 */
export type LetterErrorType = 'query' | 'render' | 'pdf' | 'validation'

export interface LetterError {
  type: LetterErrorType
  message: string
  cause?: unknown
}

/**
 * Create a LetterError.
 */
export function createLetterError(
  type: LetterErrorType,
  message: string,
  cause?: unknown,
): LetterError {
  return { type, message, cause }
}
