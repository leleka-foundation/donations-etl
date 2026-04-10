/**
 * MCP tool: query-bigquery
 *
 * Executes a read-only BigQuery SQL query against the donations table.
 * The host LLM writes the SQL; this tool just runs it safely.
 */
import {
  BigQueryClient,
  ensureLimit,
  validateReadOnlySql,
} from '@donations-etl/bq'
import { type Result, err, ok } from 'neverthrow'
import type { Logger } from 'pino'
import type { Config } from '../config'

/**
 * Dependencies injected into the tool handler for testability.
 */
export interface QueryBigQueryDeps {
  config: Config
  logger: Logger
}

/**
 * Successful query result.
 */
export interface QueryResult {
  rows: Record<string, unknown>[]
  totalRows: number
}

/**
 * Query error.
 */
export interface QueryError {
  type: 'validation' | 'query'
  message: string
}

/**
 * Handle a query-bigquery tool call.
 *
 * Validates SQL is read-only, adds a LIMIT if missing, executes the
 * query, and returns up to 50 rows.
 */
export async function handleQueryBigQuery(
  args: { sql: string },
  deps: QueryBigQueryDeps,
): Promise<Result<QueryResult, QueryError>> {
  const { config, logger } = deps

  logger.info('query-bigquery tool called')

  // Validate SQL is read-only
  const validationError = validateReadOnlySql(args.sql)
  if (validationError) {
    return err({ type: 'validation', message: validationError })
  }

  const safeSql = ensureLimit(args.sql)

  const bqClient = new BigQueryClient(
    {
      projectId: config.PROJECT_ID,
      datasetRaw: '',
      datasetCanon: config.DATASET_CANON,
    },
    { bucket: '' },
  )

  const result = await bqClient.executeReadOnlyQuery(safeSql)

  if (result.isErr()) {
    return err({ type: 'query', message: result.error.message })
  }

  const rows = result.value
  return ok({
    rows: rows.slice(0, 50),
    totalRows: rows.length,
  })
}
