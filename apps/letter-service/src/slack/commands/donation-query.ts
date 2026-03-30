/**
 * Donation query handler for Slack app_mention events.
 *
 * Translates natural language questions about donations into SQL,
 * executes against BigQuery, and posts formatted results.
 */
import type {
  BigQueryClient,
  BigQueryConfig,
  generateSql,
} from '@donations-etl/bq'
import type { Logger } from 'pino'
import type { Config } from '../../config'
import { formatQueryError, formatQueryResult } from '../formatters/query-result'

/**
 * Dependencies for the query handler, injectable for testing.
 */
export interface QueryHandlerDeps {
  generateSqlFn: typeof generateSql
  bqClient: {
    executeReadOnlyQuery: (
      sql: string,
      maxBytes?: number,
    ) => ReturnType<BigQueryClient['executeReadOnlyQuery']>
  }
  slackClient: {
    reactions: {
      add: (args: {
        channel: string
        timestamp: string
        name: string
      }) => Promise<unknown>
    }
    chat: {
      postMessage: (args: {
        channel: string
        blocks: unknown[]
        text: string
        thread_ts?: string
      }) => Promise<{ ts?: string }>
    }
  }
}

/**
 * Handle an app_mention event with a donation question.
 */
export async function handleDonationQuery(
  question: string,
  channel: string,
  threadTs: string | undefined,
  eventTs: string,
  config: Config,
  logger: Logger,
  deps: QueryHandlerDeps,
): Promise<void> {
  const { generateSqlFn, bqClient, slackClient } = deps

  // Add "thinking" reaction
  try {
    await slackClient.reactions.add({
      channel,
      timestamp: eventTs,
      name: 'hourglass_flowing_sand',
    })
  } catch {
    // Non-critical: ignore reaction errors
  }

  const bqConfig: BigQueryConfig = {
    projectId: config.PROJECT_ID,
    datasetRaw: 'donations_raw',
    datasetCanon: config.DATASET_CANON,
  }

  // Generate SQL from the question
  const sqlResult = await generateSqlFn(question, bqConfig)

  if (sqlResult.isErr()) {
    logger.error({ error: sqlResult.error, question }, 'Failed to generate SQL')
    const errorResponse = formatQueryError(
      'I had trouble understanding that question. Try rephrasing it.',
    )
    await slackClient.chat.postMessage({
      channel,
      blocks: errorResponse.blocks,
      text: errorResponse.text,
      thread_ts: threadTs ?? eventTs,
    })
    return
  }

  const { sql, explanation } = sqlResult.value

  logger.info({ question, sql, explanation }, 'Generated SQL from question')

  // Execute the query
  const queryResult = await bqClient.executeReadOnlyQuery(sql)

  if (queryResult.isErr()) {
    logger.error({ error: queryResult.error, sql }, 'Failed to execute query')
    const errorResponse = formatQueryError(
      'The query failed to execute. The question might be too complex or the data might not support it.',
    )
    await slackClient.chat.postMessage({
      channel,
      blocks: errorResponse.blocks,
      text: errorResponse.text,
      thread_ts: threadTs ?? eventTs,
    })
    return
  }

  const rows = queryResult.value

  logger.info(
    { question, rowCount: rows.length },
    'Query executed successfully',
  )

  // Format and post results
  const response = formatQueryResult(rows, explanation, sql)
  const replyTs = threadTs ?? eventTs

  const mainMsg = await slackClient.chat.postMessage({
    channel,
    blocks: response.blocks,
    text: response.text,
    thread_ts: replyTs,
  })

  // Post SQL as thread reply
  if (response.threadBlocks.length > 0 && mainMsg.ts) {
    await slackClient.chat.postMessage({
      channel,
      blocks: response.threadBlocks,
      text: 'Generated SQL',
      thread_ts: mainMsg.ts,
    })
  }
}
