/**
 * Donation query handler for Slack app_mention events.
 *
 * Uses an agentic loop to translate natural language questions
 * into SQL, execute against BigQuery, and format results for Slack.
 *
 * Supports follow-up questions in threads by fetching conversation
 * history and passing it to the agent as multi-turn context.
 */
import type {
  AgentError,
  AgentResult,
  BigQueryConfig,
  ConversationMessage,
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
    history?: ConversationMessage[],
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
    conversations: {
      replies: (args: {
        channel: string
        ts: string
        limit?: number
      }) => Promise<{
        messages?: { user?: string; bot_id?: string; text?: string }[]
      }>
    }
  }
  botUserId?: string
}

/**
 * Build conversation history from Slack thread replies.
 *
 * Maps thread messages to user/assistant roles based on whether
 * the message is from the bot or a user. Strips @mentions.
 * Excludes SQL thread replies (messages starting with "_Generated SQL:_").
 */
export function buildHistory(
  messages: { user?: string; bot_id?: string; text?: string }[],
  botUserId: string | undefined,
  _currentEventTs: string,
): ConversationMessage[] {
  const history: ConversationMessage[] = []

  for (const msg of messages) {
    // Skip the current message (it's passed separately as the prompt)
    if (msg.text === undefined) continue

    // Skip SQL thread replies
    if (msg.text.startsWith('_Generated SQL:_')) continue

    const text = msg.text.replace(/<@[A-Z0-9]+>/g, '').trim()
    if (!text) continue

    const isBot = msg.bot_id !== undefined || msg.user === botUserId
    history.push({
      role: isBot ? 'assistant' : 'user',
      content: text,
    })
  }

  // Remove the last message if it matches the current question
  // (it will be passed separately as the prompt)
  if (history.length > 0) {
    history.pop()
  }

  return history
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

  // Fetch thread history for follow-up context
  let history: ConversationMessage[] = []
  if (threadTs) {
    try {
      const threadResult = await slackClient.conversations.replies({
        channel,
        ts: threadTs,
        limit: 20,
      })
      history = buildHistory(
        threadResult.messages ?? [],
        deps.botUserId,
        eventTs,
      )
      logger.info(
        { threadTs, historyLength: history.length },
        'Fetched thread history',
      )
    } catch {
      // Non-critical: continue without history
      logger.warn({ threadTs }, 'Failed to fetch thread history')
    }
  }

  logger.info(
    { question, hasHistory: history.length > 0 },
    'Running donation agent',
  )

  const result = await runAgentFn(question, bqConfig, queryFn, history)
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
