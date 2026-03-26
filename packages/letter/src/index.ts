/**
 * @donations-etl/letter
 *
 * Donor confirmation letter generation library.
 * Queries BigQuery for donor donations, generates HTML letters, and converts to PDF.
 */

// Types and schemas
export {
  DEFAULT_ORG_ADDRESS,
  DEFAULT_ORG_MISSION,
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_TAX_STATUS,
  DEFAULT_SIGNER_NAME,
  DEFAULT_SIGNER_TITLE,
  DonationRowSchema,
  LetterRequestSchema,
  createLetterError,
  type CurrencyTotal,
  type DonationRow,
  type LetterData,
  type LetterDonation,
  type LetterError,
  type LetterErrorType,
  type LetterOptions,
  type LetterRequest,
  type YearGroup,
} from './types'

// Query module
export { queryDonations } from './query'

// HTML generation
export { generateLetterHtml, processQueryResults } from './html'

// PDF generation
export { closeBrowser, generatePdf, launchBrowser } from './pdf'
