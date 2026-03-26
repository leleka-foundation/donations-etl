/**
 * Venmo connector exports.
 */

// Schema and types
export {
  VenmoCsvRowSchema,
  isValidDonation,
  stripTransactionIdQuotes,
  type VenmoCsvRow,
} from './schema'

// Client
export {
  VenmoClient,
  getErrorMessage,
  parseCsvContent,
  resultToResultAsync,
  type IVenmoClient,
} from './client'

// Transformer
export {
  buildSourceMetadata,
  extractEmail,
  mapVenmoStatus,
  parseVenmoAmountToCents,
  parseVenmoDateTimeToISO,
  transformVenmoRow,
  transformVenmoRows,
  type TransformError,
} from './transformer'

// Connector
export { VenmoConnector, createVenmoConnector } from './connector'
