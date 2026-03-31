/**
 * Donation query handler for Slack app_mention events.
 *
 * Uses an agentic loop to translate natural language questions
 * into SQL, execute against BigQuery, and format results for Slack.
 */
import type {
  AgentError,
  AgentResult,
  BigQueryConfig,
  QueryFn,
} from '@donations-etl/bq'
import type { ResultAsync } from 'neverthrow'
import type { Logger } from 'pino'
import type { Config } from '../../config'
import { prettySql } from '../formatters/query-result'

/**
 * Dependencies for the query handler, injectable for testing.
 */
export interface QueryHandlerDeps {
  runAgentFn: (
    question: string,
    config: BigQueryConfig,
    queryFn: QueryFn,
  ) => ResultAsync<AgentResult, AgentError>
  queryFn: QueryFn
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
  const { runAgentFn, queryFn, slackClient } = deps

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

  logger.info({ question }, 'Running donation agent')

  const result = await runAgentFn(question, bqConfig, queryFn)
  const replyTs = threadTs ?? eventTs

  if (result.isErr()) {
    logger.error({ error: result.error, question }, 'Agent failed')
    await slackClient.chat.postMessage({
      channel,
      text: "I couldn't answer that question. Try rephrasing it or asking something simpler.",
      thread_ts: replyTs,
    })
    return
  }

  const { text, sql } = result.value

  logger.info({ question, sql, textLength: text.length }, 'Agent completed')

  // Post the formatted answer
  const mainMsg = await slackClient.chat.postMessage({
    channel,
    text,
    thread_ts: replyTs,
  })

  // Post SQL as thread reply
  if (sql && mainMsg.ts) {
    const formatted = prettySql(sql)
    await slackClient.chat.postMessage({
      channel,
      text: `_Generated SQL:_\n\`\`\`${formatted}\`\`\``,
      thread_ts: mainMsg.ts,
    })
  }
}
