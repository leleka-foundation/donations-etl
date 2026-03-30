/**
 * Report generation and Slack publishing.
 *
 * Queries BigQuery for donation aggregations and posts
 * formatted reports to a configured Slack channel.
 */
import { BigQueryClient, type ReportData } from '@donations-etl/bq'
import { WebClient } from '@slack/web-api'
import { DateTime } from 'luxon'
import { ResultAsync, errAsync, okAsync } from 'neverthrow'
import type { Logger } from 'pino'
import type { Config } from './config'
import { formatReport, type ReportBlock } from './report-formatter'

/**
 * Report error type.
 */
export interface ReportError {
  type: 'config' | 'bigquery' | 'slack'
  message: string
}

function createError(type: ReportError['type'], message: string): ReportError {
  return { type, message }
}

/**
 * Dependencies for the report runner, injectable for testing.
 */
export interface ReportDeps {
  bqClient: {
    queryReport: (
      fromTs: string,
      toTs: string,
    ) => ResultAsync<ReportData, { type: string; message: string }>
  }
  slackClient: {
    chat: {
      postMessage: (args: {
        channel: string
        blocks: ReportBlock[]
        text: string
        thread_ts?: string
      }) => Promise<{ ts?: string }>
    }
  }
}

/**
 * Calculate the date range for a report period.
 *
 * Weekly: past 7 days from now.
 * Monthly: previous calendar month.
 */
export function calculateDateRange(
  period: 'weekly' | 'monthly',
  now?: DateTime,
): { from: DateTime; to: DateTime; fromLabel: string; toLabel: string } {
  const ref = now ?? DateTime.utc()

  if (period === 'weekly') {
    const to = ref.startOf('day')
    const from = to.minus({ days: 7 })
    return {
      from,
      to,
      fromLabel: from.toFormat('LLL d'),
      toLabel: to.toFormat('LLL d, yyyy'),
    }
  }

  // Monthly: previous calendar month
  const prevMonth = ref.minus({ months: 1 })
  const from = prevMonth.startOf('month')
  const to = prevMonth.endOf('month').plus({ milliseconds: 1 }).startOf('day')
  return {
    from,
    to,
    fromLabel: from.toFormat('LLL d'),
    toLabel: prevMonth.endOf('month').toFormat('LLL d, yyyy'),
  }
}

/**
 * Run a donation report and post it to Slack.
 */
export function runReport(
  config: Config,
  period: 'weekly' | 'monthly',
  logger: Logger,
  deps?: Partial<ReportDeps>,
): ResultAsync<void, ReportError> {
  // Validate Slack config
  if (!config.SLACK_BOT_TOKEN) {
    return errAsync(
      createError('config', 'SLACK_BOT_TOKEN is required for reports'),
    )
  }
  if (!config.REPORT_SLACK_CHANNEL) {
    return errAsync(
      createError('config', 'REPORT_SLACK_CHANNEL is required for reports'),
    )
  }

  const slackToken = config.SLACK_BOT_TOKEN
  const channel = config.REPORT_SLACK_CHANNEL

  // Create clients (or use injected deps)
  /* istanbul ignore next -- @preserve production default: tests inject mocks */
  const bqClient =
    deps?.bqClient ??
    new BigQueryClient(
      {
        projectId: config.PROJECT_ID,
        datasetRaw: config.DATASET_RAW,
        datasetCanon: config.DATASET_CANON,
      },
      { bucket: config.BUCKET },
    )

  /* istanbul ignore next -- @preserve production default: tests inject mocks */
  const slackClient = deps?.slackClient ?? new WebClient(slackToken)

  // Calculate date range
  const { from, to, fromLabel, toLabel } = calculateDateRange(period)

  logger.info(
    { period, from: from.toISO(), to: to.toISO() },
    'Generating donation report',
  )

  // Query BigQuery
  const fromIso = from.toISO()
  const toIso = to.toISO()

  /* istanbul ignore next -- @preserve defensive: calculateDateRange always produces valid DateTimes */
  if (!fromIso || !toIso) {
    return errAsync(createError('config', 'Invalid date range calculated'))
  }

  return bqClient
    .queryReport(fromIso, toIso)
    .mapErr((e) => createError('bigquery', e.message))
    .andThen((data) => {
      logger.info(
        {
          period,
          totalCents: data.total.totalCents,
          count: data.total.count,
          sources: data.bySource.length,
          campaigns: data.byCampaign.length,
        },
        'Report data queried',
      )

      // Format as Slack blocks + thread replies
      const report = formatReport(data, period, fromLabel, toLabel)
      const fallbackText = `${period === 'weekly' ? 'Weekly' : 'Monthly'} Donation Report (${fromLabel} - ${toLabel})`

      // Post primary message
      return ResultAsync.fromPromise(
        slackClient.chat.postMessage({
          channel,
          blocks: report.blocks,
          text: fallbackText,
        }),
        (error) =>
          createError(
            'slack',
            `Failed to post report to Slack: ${error instanceof Error ? error.message : String(error)}`,
          ),
      ).andThen((result) => {
        const threadTs = result.ts
        if (!threadTs || report.threadReplies.length === 0) {
          return okAsync(undefined)
        }

        // Post each breakdown as a thread reply sequentially
        const postReply = (index: number): ResultAsync<void, ReportError> => {
          const reply = report.threadReplies[index]
          /* istanbul ignore next -- @preserve recursive base case: index past end of array */
          if (!reply) return okAsync(undefined)

          return ResultAsync.fromPromise(
            slackClient.chat.postMessage({
              channel,
              blocks: reply.blocks,
              text: reply.text,
              thread_ts: threadTs,
            }),
            (error) =>
              createError(
                'slack',
                `Failed to post thread reply: ${error instanceof Error ? error.message : String(error)}`,
              ),
          ).andThen(() => postReply(index + 1))
        }

        return postReply(0)
      })
    })
}
