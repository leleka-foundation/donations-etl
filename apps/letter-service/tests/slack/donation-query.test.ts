/**
 * Tests for donation query handler.
 */
import { errAsync, okAsync } from 'neverthrow'
import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../src/config'
import {
  handleDonationQuery,
  type QueryHandlerDeps,
} from '../../src/slack/commands/donation-query'

const logger = pino({ level: 'silent' })

type GenerateSqlFn = QueryHandlerDeps['generateSqlFn']
type ExecuteReadOnlyQueryFn =
  QueryHandlerDeps['bqClient']['executeReadOnlyQuery']
type PostMessageFn = QueryHandlerDeps['slackClient']['chat']['postMessage']
type ReactionsAddFn = QueryHandlerDeps['slackClient']['reactions']['add']

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
      generateSqlFn: vi.fn<GenerateSqlFn>().mockReturnValue(
        okAsync({
          sql: "SELECT SUM(amount_cents)/100 AS total FROM `donations.events` WHERE status = 'succeeded'",
          explanation: 'Total succeeded donations in dollars',
        }),
      ),
      bqClient: {
        executeReadOnlyQuery: vi
          .fn<ExecuteReadOnlyQueryFn>()
          .mockReturnValue(okAsync([{ total: 15000 }])),
      },
      slackClient: {
        reactions: {
          add: vi.fn<ReactionsAddFn>().mockResolvedValue({ ok: true }),
        },
        chat: {
          postMessage: vi
            .fn<PostMessageFn>()
            .mockResolvedValue({ ts: '123.456' }),
        },
      },
    }
  })

  it('generates SQL, executes query, and posts results', async () => {
    await handleDonationQuery(
      'How much did we raise?',
      'C123',
      undefined,
      '111.222',
      config,
      logger,
      deps,
    )

    expect(deps.generateSqlFn).toHaveBeenCalledWith(
      'How much did we raise?',
      expect.objectContaining({
        projectId: 'test-project',
        datasetCanon: 'donations',
      }),
    )
    expect(deps.bqClient.executeReadOnlyQuery).toHaveBeenCalled()
    expect(deps.slackClient.chat.postMessage).toHaveBeenCalled()
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
    // Second call should be the SQL thread reply
    expect(calls.length).toBe(2)
    expect(calls[1]?.[0]?.thread_ts).toBe('123.456')
    expect(calls[1]?.[0]?.text).toBe('Generated SQL')
  })

  it('handles SQL generation failure', async () => {
    deps.generateSqlFn = vi.fn<GenerateSqlFn>().mockReturnValue(
      errAsync({
        type: 'generation',
        message: 'Model error',
      }),
    )

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
    const text = calls[0]?.[0]?.text ?? ''
    expect(text).toContain('Error')
  })

  it('handles query execution failure', async () => {
    deps.bqClient.executeReadOnlyQuery = vi
      .fn<ExecuteReadOnlyQueryFn>()
      .mockReturnValue(errAsync({ type: 'query', message: 'BQ error' }))

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
    const text = calls[0]?.[0]?.text ?? ''
    expect(text).toContain('Error')
  })

  it('skips SQL thread reply when postMessage returns no ts', async () => {
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

    // Only one call (the main message), no SQL thread reply
    expect(deps.slackClient.chat.postMessage).toHaveBeenCalledTimes(1)
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

    // Should still generate SQL and post results
    expect(deps.generateSqlFn).toHaveBeenCalled()
    expect(deps.slackClient.chat.postMessage).toHaveBeenCalled()
  })
})
