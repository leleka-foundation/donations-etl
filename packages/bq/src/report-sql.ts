/**
 * SQL generation for donation report queries.
 *
 * Generates a single parameterized SQL query that returns all report
 * aggregations using CTEs, avoiding multiple BigQuery round-trips.
 */
import type { BigQueryConfig } from './types'

/**
 * Generate report SQL that returns four result sets via UNION ALL:
 * - total donations (section = 'total')
 * - breakdown by source (section = 'by_source')
 * - breakdown by campaign (section = 'by_campaign')
 * - breakdown by amount range (section = 'by_amount_range')
 *
 * Also returns a count of non-USD donations excluded from the report.
 *
 * Filters to status = 'succeeded' and currency = 'USD'.
 * Uses named parameters @from_ts and @to_ts for the date range.
 */
export function generateReportSql(config: BigQueryConfig): string {
  const { datasetCanon } = config

  return `
WITH base AS (
  SELECT *
  FROM \`${datasetCanon}.events\`
  WHERE status = 'succeeded'
    AND event_ts >= TIMESTAMP(@from_ts)
    AND event_ts < TIMESTAMP(@to_ts)
),
usd AS (
  SELECT * FROM base WHERE currency = 'USD'
),
non_usd_count AS (
  SELECT COUNT(*) AS cnt FROM base WHERE currency != 'USD'
),
total AS (
  SELECT
    'total' AS section,
    'total' AS label,
    COALESCE(SUM(amount_cents), 0) AS total_cents,
    COUNT(*) AS count,
    (SELECT cnt FROM non_usd_count) AS non_usd_excluded
  FROM usd
),
by_source AS (
  SELECT
    'by_source' AS section,
    source AS label,
    SUM(amount_cents) AS total_cents,
    COUNT(*) AS count,
    0 AS non_usd_excluded
  FROM usd
  GROUP BY source
  ORDER BY total_cents DESC
),
by_campaign AS (
  SELECT
    'by_campaign' AS section,
    COALESCE(attribution_human, 'Unattributed') AS label,
    SUM(amount_cents) AS total_cents,
    COUNT(*) AS count,
    0 AS non_usd_excluded
  FROM usd
  GROUP BY label
  ORDER BY total_cents DESC
  LIMIT 15
),
by_amount_range AS (
  SELECT
    'by_amount_range' AS section,
    CASE
      WHEN amount_cents < 10000 THEN '$0 - $100'
      WHEN amount_cents < 50000 THEN '$100 - $500'
      WHEN amount_cents < 100000 THEN '$500 - $1,000'
      WHEN amount_cents < 1000000 THEN '$1,000 - $10,000'
      ELSE '$10,000+'
    END AS label,
    SUM(amount_cents) AS total_cents,
    COUNT(*) AS count,
    0 AS non_usd_excluded
  FROM usd
  GROUP BY label
  ORDER BY MIN(amount_cents) ASC
)
SELECT * FROM total
UNION ALL
SELECT * FROM by_source
UNION ALL
SELECT * FROM by_campaign
UNION ALL
SELECT * FROM by_amount_range
`
}
