/**
 * @donations-etl/types
 *
 * Core types and schemas for the Donations ETL system.
 */

// Donation event schema and types
export {
  DonationEventSchema,
  DonationStatusEnum,
  DonorAddressSchema,
  SourceEnum,
  centsToDollars,
  dollarsToCents,
  parseDonationEvent,
  safeParseDonationEvent,
  type DonationEvent,
  type DonationEventInput,
  type DonationStatus,
  type DonorAddress,
  type Source,
} from './donation-event'

// Error types
export {
  createBigQueryError,
  createConfigError,
  createConnectorError,
  createGCSError,
  formatError,
  isBigQueryError,
  isConnectorError,
  isGCSError,
  type BigQueryError,
  type BigQueryErrorType,
  type ConfigError,
  type ConnectorError,
  type ConnectorErrorType,
  type ETLError,
  type GCSError,
  type GCSErrorType,
} from './errors'

// Result utilities
export {
  Result,
  ResultAsync,
  combineResultAsyncs,
  combineResults,
  err,
  errAsync,
  fromPromise,
  fromSafePromise,
  ok,
  okAsync,
  safeFetch,
  tapError,
  tapResult,
  traverseResultAsync,
  traverseSequential,
  wrapPromise,
} from './result'
