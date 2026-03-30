/**
 * BigQuery package types.
 */
import { z } from 'zod'

/**
 * ETL run mode.
 */
export const EtlModeSchema = z.enum(['daily', 'backfill'])
export type EtlMode = z.infer<typeof EtlModeSchema>

/**
 * ETL run status.
 */
export const EtlStatusSchema = z.enum(['started', 'succeeded', 'failed'])
export type EtlStatus = z.infer<typeof EtlStatusSchema>

/**
 * ETL run metrics per source.
 */
export const SourceMetricsSchema = z.object({
  count: z.number().int().nonnegative(),
  bytesWritten: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
})

export type SourceMetrics = z.infer<typeof SourceMetricsSchema>

/**
 * ETL run metrics.
 */
export const EtlMetricsSchema = z.object({
  sources: z.record(z.string(), SourceMetricsSchema),
  totalCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative().optional(),
})

export type EtlMetrics = z.infer<typeof EtlMetricsSchema>

/**
 * ETL run record.
 */
export const EtlRunSchema = z.object({
  run_id: z.string().uuid(),
  mode: EtlModeSchema,
  status: EtlStatusSchema,
  started_at: z.string(), // ISO timestamp
  completed_at: z.string().nullable(),
  from_ts: z.string().nullable(),
  to_ts: z.string().nullable(),
  metrics: EtlMetricsSchema.nullable(),
  error_message: z.string().nullable(),
})

export type EtlRun = z.infer<typeof EtlRunSchema>

/**
 * Extract string value from BigQueryTimestamp or passthrough string.
 * BigQuery returns TIMESTAMP columns as objects with a .value property.
 */
const extractTimestampValue = (val: unknown): unknown => {
  if (
    val !== null &&
    typeof val === 'object' &&
    'value' in val &&
    typeof val.value === 'string'
  ) {
    return val.value
  }
  return val
}

/**
 * Watermark record.
 */
export const WatermarkSchema = z.object({
  source: z.string(),
  last_success_to_ts: z.preprocess(extractTimestampValue, z.string()), // ISO timestamp
  updated_at: z.preprocess(extractTimestampValue, z.string()), // ISO timestamp
})

export type Watermark = z.infer<typeof WatermarkSchema>

/**
 * BigQuery configuration.
 */
export interface BigQueryConfig {
  projectId: string
  datasetRaw: string
  datasetCanon: string
}

/**
 * Report row returned from the unified report query.
 * Each row belongs to a section (total, by_source, by_campaign, by_amount_range).
 */
export const ReportRowSchema = z.object({
  section: z.enum(['total', 'by_source', 'by_campaign', 'by_amount_range']),
  label: z.string(),
  total_cents: z.coerce.number(),
  count: z.coerce.number(),
  non_usd_excluded: z.coerce.number(),
})

export type ReportRow = z.infer<typeof ReportRowSchema>

/**
 * Structured report data, parsed from report query rows.
 */
export interface ReportData {
  total: { totalCents: number; count: number; nonUsdExcluded: number }
  bySource: { label: string; totalCents: number; count: number }[]
  byCampaign: { label: string; totalCents: number; count: number }[]
  byAmountRange: { label: string; totalCents: number; count: number }[]
}

/**
 * Parse raw report rows into structured ReportData.
 */
export function parseReportRows(rows: ReportRow[]): ReportData {
  const totalRow = rows.find((r) => r.section === 'total')
  return {
    total: {
      totalCents: totalRow?.total_cents ?? 0,
      count: totalRow?.count ?? 0,
      nonUsdExcluded: totalRow?.non_usd_excluded ?? 0,
    },
    bySource: rows
      .filter((r) => r.section === 'by_source')
      .map((r) => ({
        label: r.label,
        totalCents: r.total_cents,
        count: r.count,
      })),
    byCampaign: rows
      .filter((r) => r.section === 'by_campaign')
      .map((r) => ({
        label: r.label,
        totalCents: r.total_cents,
        count: r.count,
      })),
    byAmountRange: rows
      .filter((r) => r.section === 'by_amount_range')
      .map((r) => ({
        label: r.label,
        totalCents: r.total_cents,
        count: r.count,
      })),
  }
}

/**
 * GCS configuration.
 */
export interface GCSConfig {
  bucket: string
  prefix?: string
}

/**
 * Load options for BigQuery load job.
 */
export interface LoadOptions {
  runId: string
  source: string
  gcsUri: string
}

/**
 * Merge options for MERGE operation.
 */
export interface MergeOptions {
  runId: string
}

/**
 * Result of a BigQuery load job.
 */
export interface LoadResult {
  rowsLoaded: number
  bytesProcessed: number
}

/**
 * Result of a MERGE operation.
 */
export interface MergeResult {
  rowsInserted: number
  rowsUpdated: number
}
