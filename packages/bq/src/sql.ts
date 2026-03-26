/**
 * SQL generation for BigQuery operations.
 *
 * Generates parameterized SQL queries for merge and watermark operations.
 */
import type { BigQueryConfig } from './types'

/**
 * Generate MERGE SQL for staging → canonical.
 *
 * Uses parameterized query with @run_id for safety.
 * Deduplicates staging data by (source, external_id) to handle cases
 * where source APIs return the same event multiple times.
 *
 * Applies source-specific filtering:
 * - Mercury: Only external incoming donations (excludes internal transfers and debits)
 */
export function generateMergeSql(config: BigQueryConfig): string {
  const { datasetRaw, datasetCanon } = config

  return `
MERGE \`${datasetCanon}.events\` AS target
USING (
  SELECT * EXCEPT(row_num) FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY source, external_id ORDER BY ingested_at DESC) AS row_num
    FROM \`${datasetRaw}.stg_events\`
    WHERE run_id = @run_id
      -- Mercury-specific filtering: only external incoming donations
      -- Note: Account-level filtering is intentionally not implemented here.
      -- Mercury account names are masked (e.g., "Mercury Checking ••9832") and
      -- don't match user-friendly names. All accounts are included for now.
      AND NOT (
        source = 'mercury'
        AND (
          payment_method = 'internal'  -- Exclude internal transfers
          -- JSON_VALUE returns strings, so we compare against 'false' (string)
          OR JSON_VALUE(source_metadata, '$.isCredit') = 'false'  -- Exclude debits
          OR payment_method = 'check'  -- Exclude checks (tracked via check_deposits source)
        )
      )
  )
  WHERE row_num = 1
) AS source
ON target.source = source.source AND target.external_id = source.external_id
WHEN MATCHED THEN UPDATE SET
  event_ts = source.event_ts,
  created_at = source.created_at,
  ingested_at = source.ingested_at,
  amount_cents = source.amount_cents,
  fee_cents = source.fee_cents,
  net_amount_cents = source.net_amount_cents,
  currency = source.currency,
  donor_name = source.donor_name,
  payer_name = source.payer_name,
  donor_email = source.donor_email,
  donor_phone = source.donor_phone,
  donor_address = source.donor_address,
  status = source.status,
  payment_method = source.payment_method,
  description = source.description,
  attribution = source.attribution,
  attribution_human = source.attribution_human,
  source_metadata = source.source_metadata,
  _updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (
  source, external_id, event_ts, created_at, ingested_at,
  amount_cents, fee_cents, net_amount_cents, currency,
  donor_name, payer_name, donor_email, donor_phone, donor_address,
  status, payment_method, description, attribution, attribution_human, source_metadata
) VALUES (
  source.source, source.external_id, source.event_ts, source.created_at, source.ingested_at,
  source.amount_cents, source.fee_cents, source.net_amount_cents, source.currency,
  source.donor_name, source.payer_name, source.donor_email, source.donor_phone, source.donor_address,
  source.status, source.payment_method, source.description, source.attribution, source.attribution_human, source.source_metadata
)`.trim()
}

/**
 * Generate SQL to get the latest watermark for a source.
 */
export function generateGetWatermarkSql(config: BigQueryConfig): string {
  const { datasetRaw } = config

  return `
SELECT source, last_success_to_ts, updated_at
FROM \`${datasetRaw}.etl_watermarks\`
WHERE source = @source
LIMIT 1`.trim()
}

/**
 * Generate SQL to upsert a watermark.
 */
export function generateUpsertWatermarkSql(config: BigQueryConfig): string {
  const { datasetRaw } = config

  return `
MERGE \`${datasetRaw}.etl_watermarks\` AS target
USING (
  SELECT @source AS source, CAST(@last_success_to_ts AS TIMESTAMP) AS last_success_to_ts, CAST(@updated_at AS TIMESTAMP) AS updated_at
) AS source
ON target.source = source.source
WHEN MATCHED THEN UPDATE SET
  last_success_to_ts = source.last_success_to_ts,
  updated_at = source.updated_at
WHEN NOT MATCHED THEN INSERT (source, last_success_to_ts, updated_at)
VALUES (source.source, source.last_success_to_ts, source.updated_at)`.trim()
}

/**
 * Generate SQL to insert an ETL run record.
 */
export function generateInsertRunSql(config: BigQueryConfig): string {
  const { datasetRaw } = config

  return `
INSERT INTO \`${datasetRaw}.etl_runs\`
(run_id, mode, status, started_at, completed_at, from_ts, to_ts, metrics, error_message)
VALUES
(@run_id, @mode, @status, @started_at, @completed_at, @from_ts, @to_ts, @metrics, @error_message)`.trim()
}

/**
 * Generate SQL to update an ETL run record.
 */
export function generateUpdateRunSql(config: BigQueryConfig): string {
  const { datasetRaw } = config

  return `
UPDATE \`${datasetRaw}.etl_runs\`
SET status = @status,
    completed_at = @completed_at,
    metrics = @metrics,
    error_message = @error_message
WHERE run_id = @run_id`.trim()
}

/**
 * Generate SQL to get an ETL run by ID.
 */
export function generateGetRunSql(config: BigQueryConfig): string {
  const { datasetRaw } = config

  return `
SELECT run_id, mode, status, started_at, completed_at, from_ts, to_ts, metrics, error_message
FROM \`${datasetRaw}.etl_runs\`
WHERE run_id = @run_id
LIMIT 1`.trim()
}
