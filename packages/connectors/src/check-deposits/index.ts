/**
 * Check Deposits connector exports.
 *
 * Reads donation data from Google Sheets check deposits spreadsheet.
 */

// Client
export { CheckDepositsClient } from './client'

// Connector
export {
  CheckDepositsConnector,
  type CheckDepositsConnectorOptions,
  type ICheckDepositsClient,
} from './connector'

// Schema (CheckDepositsConfig is exported from ../types)
export {
  CheckDepositRowSchema,
  CheckDepositsConfigSchema,
  type CheckDepositRow,
} from './schema'

// Transformer
export {
  generateExternalId,
  parseAddress,
  parseAmountToCents,
  parseDateToISO,
  transformCheckDepositRow,
  transformCheckDepositRows,
} from './transformer'
