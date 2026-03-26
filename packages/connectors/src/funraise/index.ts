/**
 * Funraise connector for CSV exports.
 */
export {
  FunraiseClient,
  parseCsvContent,
  preprocessCsv,
  type IFunraiseClient,
} from './client'

export { FunraiseConnector, type FunraiseConnectorOptions } from './connector'

export { FunraiseCsvRowSchema, type FunraiseCsvRow } from './schema'

export {
  buildSourceMetadata,
  extractDonorAddress,
  extractEmail,
  extractPhone,
  formatDonorName,
  mapFunraiseStatus,
  parseAmountToCents,
  parseFunraiseDateToISO,
  transformFunraiseRow,
  transformFunraiseRows,
  type TransformError,
} from './transformer'
