/**
 * Tests for donation query handler.
 */
import { errAsync, okAsync } from 'neverthrow'
import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../src/config'
import {
  buildHistory,
  handleDonationQuery,
  type QueryHandlerDeps,
} from '../../src/slack/commands/donation-query'

const logger = pino({ level: 'silent' })

type RunAgentFn = QueryHandlerDeps['runAgentFn']
type PostMessageFn = QueryHandlerDeps['slackClient']['chat']['postMessage']
type ReactionsAddFn = QueryHandlerDeps['slackClient']['reactions']['add']
type ConversationsRepliesFn =
  QueryHandlerDeps['slackClient']['conversations']['replies']

describe('handleDonationQuery', () => {
  let config: Config
  let deps: QueryHandlerDeps

  beforeEach(() => {
    config = {
      PORT: 8080,
      LOG_LEVEL: 'info',
      PROJECT_ID: 'test-project',
      DATASET_CANON: 'donations',
      LETTER_SERVICE_API_KEY: 'test-key',
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_SIGNING_SECRET: 'test-secret',
      ORG_NAME: 'Test Org',
      ORG_ADDRESS: '',
      ORG_MISSION: 'Test mission',
      ORG_TAX_STATUS: 'Test tax',
      DEFAULT_SIGNER_NAME: 'Test Signer',
      DEFAULT_SIGNER_TITLE: 'Director',
    }

    deps = {
      runAgentFn: vi.fn<RunAgentFn>().mockReturnValue(
        okAsync({
          text: '*$15,000* total donations',
          sql: "SELECT SUM(amount_cents)/100 FROM events WHERE status = 'succeeded'",
        }),
      ),
      queryFn: vi.fn<QueryHandlerDeps['queryFn']>(),
      slackClient: {
        reactions: {
          add: vi.fn<ReactionsAddFn>().mockResolvedValue({ ok: true }),
        },
        chat: {
          postMessage: vi
            .fn<PostMessageFn>()
            .mockResolvedValue({ ts: '123.456' }),
        },
        conversations: {
          replies: vi
            .fn<ConversationsRepliesFn>()
            .mockResolvedValue({ messages: [] }),
        },
      },
      botUserId: 'B123',
    }
  })

  it('runs agent and posts formatted result', async () => {
    await handleDonationQuery(
      'How much did we raise?',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    expect(deps.runAgentFn).toHaveBeenCalledWith(
      'How much did we raise?',
      expect.objectContaining({ projectId: 'test-project' }),
      deps.queryFn,
      [], // no history for non-threaded messages
    )
    const calls = vi.mocked(deps.slackClient.chat.postMessage).mock.calls
    expect(calls[0]?.[0]?.text).toContain('$15,000')
  })

  it('adds thinking reaction', async () => {
    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    expect(deps.slackClient.reactions.add).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '111.222',
      name: 'hourglass_flowing_sand',
    })
  })

  it('replies in thread when threadTs is provided', async () => {
    await handleDonationQuery(
      'test',
      'C123',
      '999.888',
      '111.222',
      config,
      logger,
      deps,
    )

    const calls = vi.mocked(deps.slackClient.chat.postMessage).mock.calls
    expect(calls[0]?.[0]?.thread_ts).toBe('999.888')
  })

  it('uses eventTs as thread when no threadTs', async () => {
    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    const calls = vi.mocked(deps.slackClient.chat.postMessage).mock.calls
    expect(calls[0]?.[0]?.thread_ts).toBe('111.222')
  })

  it('posts SQL as thread reply', async () => {
    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    const calls = vi.mocked(deps.slackClient.chat.postMessage).mock.calls
    expect(calls.length).toBe(2)
    expect(calls[1]?.[0]?.thread_ts).toBe('123.456')
    expect(calls[1]?.[0]?.text).toContain('Generated SQL')
  })

  it('skips SQL reply when agent returns no SQL', async () => {
    deps.runAgentFn = vi
      .fn<RunAgentFn>()
      .mockReturnValue(okAsync({ text: 'I need more info', sql: null }))

    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    const calls = vi.mocked(deps.slackClient.chat.postMessage).mock.calls
    expect(calls.length).toBe(1)
  })

  it('skips SQL reply when postMessage returns no ts', async () => {
    deps.slackClient.chat.postMessage = vi
      .fn<PostMessageFn>()
      .mockResolvedValue({})

    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    expect(deps.slackClient.chat.postMessage).toHaveBeenCalledTimes(1)
  })

  it('handles agent failure', async () => {
    deps.runAgentFn = vi
      .fn<RunAgentFn>()
      .mockReturnValue(errAsync({ type: 'agent', message: 'Model error' }))

    await handleDonationQuery(
      'bad question',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    const calls = vi.mocked(deps.slackClient.chat.postMessage).mock.calls
    expect(calls.length).toBe(1)
    expect(calls[0]?.[0]?.text).toContain("couldn't answer")
  })

  it('continues when reaction add fails', async () => {
    deps.slackClient.reactions.add = vi
      .fn<ReactionsAddFn>()
      .mockRejectedValue(new Error('no permission'))

    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    expect(deps.runAgentFn).toHaveBeenCalled()
    expect(deps.slackClient.chat.postMessage).toHaveBeenCalled()
  })

  it('fetches thread history for follow-up questions', async () => {
    deps.slackClient.conversations.replies = vi
      .fn<ConversationsRepliesFn>()
      .mockResolvedValue({
        messages: [
          { user: 'U999', text: '<@B123> compare march donations' },
          {
            bot_id: 'B456',
            text: '*$10,000* in March 2025 vs *$15,000* in March 2026',
          },
          { user: 'U999', text: '<@B123> break down by source' },
        ],
      })

    await handleDonationQuery(
      'break down by source',
      'C123',
      '100.200', // threadTs present = follow-up
      '300.400',
      config,
      logger,
      deps,
    )

    // Should have fetched thread history
    expect(deps.slackClient.conversations.replies).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '100.200',
      limit: 20,
    })

    // Should pass history to the agent
    const agentCall = vi.mocked(deps.runAgentFn).mock.calls[0]
    const history = agentCall?.[3]
    expect(history).toBeDefined()
    expect(history?.length).toBeGreaterThan(0)
  })

  it('continues without history when thread fetch fails', async () => {
    deps.slackClient.conversations.replies = vi
      .fn<ConversationsRepliesFn>()
      .mockRejectedValue(new Error('no permission'))

    await handleDonationQuery(
      'test',
      'C123',
      '100.200',
      '300.400',
      config,
      logger,
      deps,
    )

    // Should still run the agent
    expect(deps.runAgentFn).toHaveBeenCalled()
    const history = vi.mocked(deps.runAgentFn).mock.calls[0]?.[3]
    expect(history).toEqual([])
  })

  it('handles conversations.replies returning no messages', async () => {
    deps.slackClient.conversations.replies = vi
      .fn<ConversationsRepliesFn>()
      .mockResolvedValue({})

    await handleDonationQuery(
      'test',
      'C123',
      '100.200',
      '300.400',
      config,
      logger,
      deps,
    )

    expect(deps.runAgentFn).toHaveBeenCalled()
    const history = vi.mocked(deps.runAgentFn).mock.calls[0]?.[3]
    expect(history).toEqual([])
  })

  it('does not fetch history when no threadTs', async () => {
    await handleDonationQuery(
      'test',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    expect(deps.slackClient.conversations.replies).not.toHaveBeenCalled()
  })
})

describe('buildHistory', () => {
  it('maps user messages and bot messages', () => {
    const messages = [
      { user: 'U999', text: '<@B123> how much raised?' },
      { bot_id: 'B456', text: '*$15,000* total' },
      { user: 'U999', text: '<@B123> break down by source' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    expect(history).toEqual([
      { role: 'user', content: 'how much raised?' },
      { role: 'assistant', content: '*$15,000* total' },
    ])
  })

  it('identifies bot by user ID', () => {
    const messages = [
      { user: 'U999', text: 'question' },
      { user: 'B123', text: 'answer' },
      { user: 'U999', text: 'follow-up' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    expect(history[0]?.role).toBe('user')
    expect(history[1]?.role).toBe('assistant')
  })

  it('strips @mentions from text', () => {
    const messages = [
      { user: 'U999', text: '<@B123> what is the total?' },
      { user: 'U999', text: 'follow-up' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    expect(history[0]?.content).toBe('what is the total?')
  })

  it('skips SQL thread replies', () => {
    const messages = [
      { user: 'U999', text: 'question' },
      { bot_id: 'B456', text: 'answer' },
      { bot_id: 'B456', text: '_Generated SQL:_\n```SELECT 1```' },
      { user: 'U999', text: 'follow-up' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    expect(history).toHaveLength(2)
    expect(history.every((m) => !m.content.includes('SQL'))).toBe(true)
  })

  it('skips empty messages', () => {
    const messages = [
      { user: 'U999', text: '<@B123>' }, // Only mention, no content
      { user: 'U999', text: 'real question' },
      { user: 'U999', text: 'follow-up' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    expect(history[0]?.content).toBe('real question')
  })

  it('removes the last message (current question)', () => {
    const messages = [
      { user: 'U999', text: 'first question' },
      { bot_id: 'B456', text: 'first answer' },
      { user: 'U999', text: 'second question' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    // Last message (second question) should be removed
    expect(history).toHaveLength(2)
    expect(history[1]?.content).toBe('first answer')
  })

  it('returns empty array for empty messages', () => {
    expect(buildHistory([], 'B123', '333.444')).toEqual([])
  })

  it('handles messages with undefined text', () => {
    const messages = [
      { user: 'U999', text: undefined },
      { user: 'U999', text: 'real question' },
      { user: 'U999', text: 'follow-up' },
    ]
    const history = buildHistory(messages, 'B123', '333.444')

    expect(history[0]?.content).toBe('real question')
  })
})
