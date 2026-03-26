/**
 * Error types for the ETL system.
 *
 * All errors are discriminated union types that can be pattern-matched.
 * These are used with neverthrow Result types throughout the codebase.
 */
import type { Source } from './donation-event'

/**
 * Connector error types.
 */
export type ConnectorErrorType =
  | 'api' // Non-2xx HTTP response
  | 'auth' // 401/403 authentication error
  | 'rate_limit' // 429 rate limiting
  | 'validation' // Zod schema validation failure
  | 'network' // Connection/network error

/**
 * Error from a data source connector.
 */
export interface ConnectorError {
  type: ConnectorErrorType
  source: Source
  message: string
  statusCode?: number
  retryable: boolean
}

/**
 * BigQuery error types.
 */
export type BigQueryErrorType =
  | 'query' // Query execution error
  | 'load' // Load job error
  | 'schema' // Schema mismatch
  | 'auth' // Authentication error
  | 'quota' // Quota exceeded

/**
 * Error from BigQuery operations.
 */
export interface BigQueryError {
  type: BigQueryErrorType
  message: string
  jobId?: string
  retryable: boolean
}

/**
 * GCS error types.
 */
export type GCSErrorType =
  | 'upload' // Upload failed
  | 'download' // Download failed
  | 'auth' // Authentication error
  | 'not_found' // Object not found
  | 'quota' // Quota exceeded

/**
 * Error from GCS operations.
 */
export interface GCSError {
  type: GCSErrorType
  message: string
  bucket?: string
  path?: string
  retryable: boolean
}

/**
 * Configuration error.
 */
export interface ConfigError {
  type: 'config'
  message: string
  field?: string
}

/**
 * Union of all error types.
 */
export type ETLError = ConnectorError | BigQueryError | GCSError | ConfigError

/**
 * Create a connector error.
 */
export function createConnectorError(
  type: ConnectorErrorType,
  source: Source,
  message: string,
  options?: { statusCode?: number; retryable?: boolean },
): ConnectorError {
  return {
    type,
    source,
    message,
    statusCode: options?.statusCode,
    retryable: options?.retryable ?? isRetryableByDefault(type),
  }
}

/**
 * Create a BigQuery error.
 */
export function createBigQueryError(
  type: BigQueryErrorType,
  message: string,
  options?: { jobId?: string; retryable?: boolean },
): BigQueryError {
  return {
    type,
    message,
    jobId: options?.jobId,
    retryable: options?.retryable ?? type === 'quota',
  }
}

/**
 * Create a GCS error.
 */
export function createGCSError(
  type: GCSErrorType,
  message: string,
  options?: { bucket?: string; path?: string; retryable?: boolean },
): GCSError {
  return {
    type,
    message,
    bucket: options?.bucket,
    path: options?.path,
    retryable: options?.retryable ?? type === 'quota',
  }
}

/**
 * Create a config error.
 */
export function createConfigError(
  message: string,
  field?: string,
): ConfigError {
  return {
    type: 'config',
    message,
    field,
  }
}

/**
 * Determine if an error type is retryable by default.
 */
function isRetryableByDefault(type: ConnectorErrorType): boolean {
  switch (type) {
    case 'network':
    case 'rate_limit':
      return true
    case 'api':
    case 'auth':
    case 'validation':
      return false
  }
}

/**
 * Type guard to check if error is a ConnectorError.
 */
export function isConnectorError(error: ETLError): error is ConnectorError {
  return 'source' in error
}

/**
 * Type guard to check if error is a BigQueryError.
 */
export function isBigQueryError(error: ETLError): error is BigQueryError {
  return (
    error.type === 'query' ||
    error.type === 'load' ||
    error.type === 'schema' ||
    (error.type === 'quota' && !('bucket' in error)) ||
    (error.type === 'auth' && !('source' in error))
  )
}

/**
 * Type guard to check if error is a GCSError.
 */
export function isGCSError(error: ETLError): error is GCSError {
  return (
    error.type === 'upload' ||
    error.type === 'download' ||
    error.type === 'not_found' ||
    (error.type === 'quota' && 'bucket' in error) ||
    (error.type === 'auth' && 'bucket' in error)
  )
}

/**
 * Format an error for logging.
 */
export function formatError(error: ETLError): string {
  if (isConnectorError(error)) {
    return `[${error.source}] ${error.type}: ${error.message}`
  }

  if (error.type === 'config') {
    return `[Config] ${error.message}${error.field ? ` (field: ${error.field})` : ''}`
  }

  if (isGCSError(error)) {
    return `[GCS] ${error.type}: ${error.message}`
  }

  // BigQuery errors
  return `[BigQuery] ${error.type}: ${error.message}`
}
