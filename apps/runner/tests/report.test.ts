/**
 * Tests for report generation and Slack publishing.
 */
import type { ReportData } from '@donations-etl/bq'
import { DateTime } from 'luxon'
import { errAsync, okAsync } from 'neverthrow'
import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config'
import { calculateDateRange, runReport, type ReportDeps } from '../src/report'

const logger = pino({ level: 'silent' })

describe('calculateDateRange', () => {
  it('calculates weekly range as past 7 days', () => {
    const now = DateTime.fromISO('2026-03-30T10:00:00Z', { zone: 'utc' })
    const { from, to, fromLabel, toLabel } = calculateDateRange('weekly', now)

    expect(from.toISODate()).toBe('2026-03-23')
    expect(to.toISODate()).toBe('2026-03-30')
    expect(fromLabel).toBe('Mar 23')
    expect(toLabel).toBe('Mar 30, 2026')
  })

  it('calculates monthly range as previous calendar month', () => {
    const now = DateTime.fromISO('2026-03-15T10:00:00Z', { zone: 'utc' })
    const { from, to, fromLabel, toLabel } = calculateDateRange('monthly', now)

    expect(from.toISODate()).toBe('2026-02-01')
    expect(to.toISODate()).toBe('2026-03-01') // exclusive end
    expect(fromLabel).toBe('Feb 1')
    expect(toLabel).toBe('Feb 28, 2026')
  })

  it('handles monthly range for January (previous month is December)', () => {
    const now = DateTime.fromISO('2026-01-10T10:00:00Z', { zone: 'utc' })
    const { from, to } = calculateDateRange('monthly', now)

    expect(from.toISODate()).toBe('2025-12-01')
    expect(to.toISODate()).toBe('2026-01-01')
  })

  it('uses current time when now is not provided', () => {
    const { from, to } = calculateDateRange('weekly')
    expect(from < to).toBe(true)
  })
})

describe('runReport', () => {
  const mockReportData: ReportData = {
    total: { totalCents: 1500000, count: 42, nonUsdExcluded: 0 },
    bySource: [
      { label: 'mercury', totalCents: 500000, count: 10 },
      { label: 'paypal', totalCents: 1000000, count: 32 },
    ],
    byCampaign: [{ label: 'Spring Drive', totalCents: 800000, count: 25 }],
    byAmountRange: [{ label: '$0 - $100', totalCents: 150000, count: 25 }],
  }

  type QueryReportFn = ReportDeps['bqClient']['queryReport']
  type PostMessageFn = ReportDeps['slackClient']['chat']['postMessage']

  let config: Config
  let mockDeps: ReportDeps

  beforeEach(() => {
    config = {
      PROJECT_ID: 'test-project',
      BUCKET: 'test-bucket',
      DATASET_RAW: 'donations_raw',
      DATASET_CANON: 'donations',
      LOOKBACK_HOURS: 48,
      LOG_LEVEL: 'info',
      CHECK_DEPOSITS_SHEET_NAME: 'checks',
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      REPORT_SLACK_CHANNEL: 'C123456',
    }

    mockDeps = {
      bqClient: {
        queryReport: vi
          .fn<QueryReportFn>()
          .mockReturnValue(okAsync(mockReportData)),
      },
      slackClient: {
        chat: {
          postMessage: vi
            .fn<PostMessageFn>()
            .mockResolvedValue({ ts: '1234567890.123456' }),
        },
      },
    }
  })

  it('queries BigQuery and posts to Slack', async () => {
    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isOk()).toBe(true)
    expect(mockDeps.bqClient.queryReport).toHaveBeenCalled()
    expect(mockDeps.slackClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123456',
      }),
    )
  })

  it('sends primary message and thread replies to Slack', async () => {
    await runReport(config, 'weekly', logger, mockDeps)

    const calls = vi.mocked(mockDeps.slackClient.chat.postMessage).mock.calls
    // Primary message + 3 thread replies (source, campaign, amount range)
    expect(calls.length).toBe(4)
    // Primary message has no thread_ts
    expect(calls[0]?.[0]?.thread_ts).toBeUndefined()
    expect(calls[0]?.[0]?.text).toContain('Weekly Donation Report')
    // Thread replies have thread_ts
    expect(calls[1]?.[0]?.thread_ts).toBe('1234567890.123456')
    expect(calls[2]?.[0]?.thread_ts).toBe('1234567890.123456')
    expect(calls[3]?.[0]?.thread_ts).toBe('1234567890.123456')
  })

  it('sends monthly report with correct label', async () => {
    await runReport(config, 'monthly', logger, mockDeps)

    const call = vi.mocked(mockDeps.slackClient.chat.postMessage).mock
      .calls[0]?.[0]
    expect(call?.text).toContain('Monthly Donation Report')
  })

  it('skips thread replies when primary message returns no ts', async () => {
    mockDeps.slackClient.chat.postMessage = vi
      .fn<PostMessageFn>()
      .mockResolvedValue({})

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isOk()).toBe(true)
    // Only the primary message was sent
    expect(mockDeps.slackClient.chat.postMessage).toHaveBeenCalledTimes(1)
  })

  it('returns error when SLACK_BOT_TOKEN is missing', async () => {
    config.SLACK_BOT_TOKEN = undefined

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('config')
      expect(result.error.message).toContain('SLACK_BOT_TOKEN')
    }
  })

  it('returns error when REPORT_SLACK_CHANNEL is missing', async () => {
    config.REPORT_SLACK_CHANNEL = undefined

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('config')
      expect(result.error.message).toContain('REPORT_SLACK_CHANNEL')
    }
  })

  it('returns error when BigQuery query fails', async () => {
    mockDeps.bqClient.queryReport = vi
      .fn<QueryReportFn>()
      .mockReturnValue(errAsync({ type: 'query', message: 'BQ error' }))

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('bigquery')
      expect(result.error.message).toContain('BQ error')
    }
  })

  it('returns error when Slack posting fails', async () => {
    mockDeps.slackClient.chat.postMessage = vi
      .fn<PostMessageFn>()
      .mockRejectedValue(new Error('Slack API error'))

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('slack')
      expect(result.error.message).toContain('Slack API error')
    }
  })

  it('returns error when thread reply fails', async () => {
    let callCount = 0
    mockDeps.slackClient.chat.postMessage = vi
      .fn<PostMessageFn>()
      .mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve({ ts: '123.456' })
        return Promise.reject(new Error('Thread reply failed'))
      })

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('slack')
      expect(result.error.message).toContain('Thread reply failed')
    }
  })

  it('handles non-Error thread reply failures', async () => {
    let callCount = 0
    mockDeps.slackClient.chat.postMessage = vi
      .fn<PostMessageFn>()
      .mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve({ ts: '123.456' })
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject('string error in thread')
      })

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('slack')
      expect(result.error.message).toContain('string error in thread')
    }
  })

  it('handles non-Error Slack failures', async () => {
    mockDeps.slackClient.chat.postMessage = vi
      .fn<PostMessageFn>()
      .mockRejectedValue('string error')

    const result = await runReport(config, 'weekly', logger, mockDeps)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('slack')
      expect(result.error.message).toContain('string error')
    }
  })
})
