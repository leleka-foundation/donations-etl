/**
 * BigQuery query module for donor donation history.
 *
 * Queries the canonical donations.events table for a donor's succeeded transactions.
 */
import { BigQuery } from '@google-cloud/bigquery'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import { z } from 'zod'
import {
  type DonationRow,
  DonationRowSchema,
  type LetterError,
  createLetterError,
} from './types'

/**
 * Configuration for the query module.
 */
export interface QueryConfig {
  projectId: string
  dataset: string
}

/**
 * Build the SQL query for donor donations.
 *
 * Uses parameterized queries to prevent SQL injection.
 * The @PROJECT and @DATASET placeholders are replaced with config values
 * (safe: they come from validated server config, not user input).
 */
export function buildDonationQuery(
  emails: string[],
  from?: string,
  to?: string,
): { sql: string; params: Record<string, string | string[]> } {
  let sql = `
SELECT
  event_ts,
  ROUND(amount_cents / 100, 2) AS amount,
  currency,
  source,
  status,
  donor_name,
  donor_email
FROM \`@PROJECT.@DATASET.events\`
WHERE donor_email IN UNNEST(@emails)
  AND status = 'succeeded'`

  const params: Record<string, string | string[]> = { emails }

  if (from) {
    sql += `\n  AND event_ts >= TIMESTAMP(@from_date)`
    params.from_date = from
  }

  if (to) {
    sql += `\n  AND event_ts < TIMESTAMP(@to_date)`
    params.to_date = to
  }

  sql += `\nORDER BY event_ts ASC`

  return { sql, params }
}

/**
 * Query BigQuery for a donor's donation history.
 *
 * Returns all succeeded donations for the given email(s),
 * optionally filtered by date range.
 */
export function queryDonations(
  config: QueryConfig,
  emails: string[],
  from?: string,
  to?: string,
): ResultAsync<DonationRow[], LetterError> {
  const bq = new BigQuery({ projectId: config.projectId })
  const { sql, params } = buildDonationQuery(emails, from, to)

  const query = sql
    .replace('@PROJECT', config.projectId)
    .replace('@DATASET', config.dataset)

  return ResultAsync.fromPromise(bq.query({ query, params }), (error) =>
    createLetterError(
      'query',
      `Failed to query donations: ${error instanceof Error ? error.message : String(error)}`,
      error,
    ),
  ).andThen(([rows]) => {
    const parsed = z.array(DonationRowSchema).safeParse(rows)
    if (!parsed.success) {
      return errAsync(
        createLetterError(
          'validation',
          `Invalid query results: ${parsed.error.message}`,
          parsed.error,
        ),
      )
    }
    return okAsync(parsed.data)
  })
}
