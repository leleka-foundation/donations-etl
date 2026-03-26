/**
 * @donations-etl/bq
 *
 * BigQuery integration for Donations ETL.
 */

// Client
export {
  BigQueryClient,
  type BigQueryError,
  type BigQueryErrorType,
} from './client'

// Types
export {
  EtlMetricsSchema,
  EtlModeSchema,
  EtlRunSchema,
  EtlStatusSchema,
  SourceMetricsSchema,
  WatermarkSchema,
  type BigQueryConfig,
  type EtlMetrics,
  type EtlMode,
  type EtlRun,
  type EtlStatus,
  type GCSConfig,
  type LoadOptions,
  type LoadResult,
  type MergeOptions,
  type MergeResult,
  type SourceMetrics,
  type Watermark,
} from './types'

// SQL generation
export {
  generateGetRunSql,
  generateGetWatermarkSql,
  generateInsertRunSql,
  generateMergeSql,
  generateUpdateRunSql,
  generateUpsertWatermarkSql,
} from './sql'

// NDJSON utilities
export {
  chunkEvents,
  eventToNdjsonLine,
  eventsToNdjson,
  generateGcsPath,
  generateGcsPattern,
  generateGcsUri,
} from './ndjson'
