/**
 * Slack Block Kit formatter for donation reports.
 *
 * Converts structured ReportData into Slack Block Kit blocks
 * and collapsible attachments for readable, rich formatting.
 *
 * The report is structured as:
 * - Primary blocks: header + total summary
 * - Attachments: one per breakdown section (collapsible in Slack)
 */
import type { ReportData } from '@donations-etl/bq'

/**
 * Slack Block Kit block types used in report formatting.
 */
export interface HeaderBlock {
  type: 'header'
  text: { type: 'plain_text'; text: string }
}

export interface SectionBlock {
  type: 'section'
  text: { type: 'mrkdwn'; text: string }
}

export interface DividerBlock {
  type: 'divider'
}

export type ReportBlock = HeaderBlock | SectionBlock | DividerBlock

/**
 * A thread reply containing a breakdown section.
 */
export interface ReportThreadReply {
  blocks: ReportBlock[]
  text: string
}

/**
 * Complete formatted report ready to send to Slack.
 *
 * - blocks: primary message (header + total summary)
 * - threadReplies: one per breakdown section, posted as thread replies
 */
export interface FormattedReport {
  blocks: ReportBlock[]
  threadReplies: ReportThreadReply[]
}

/**
 * Format cents as a dollar string with commas.
 * e.g., 1234567 => "$12,345.67"
 */
export function formatCents(cents: number): string {
  const dollars = cents / 100
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Maximum label length before truncation.
 */
const MAX_LABEL_LENGTH = 25

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label
  return label.slice(0, MAX_LABEL_LENGTH - 1) + '…'
}

/**
 * Pad a string to a fixed width (right-pad with spaces).
 */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}

/**
 * Right-align a string to a fixed width.
 */
function rpad(str: string, width: number): string {
  return str.length >= width ? str : ' '.repeat(width - str.length) + str
}

/**
 * Format a breakdown table as monospace mrkdwn text.
 */
function formatTable(
  rows: { label: string; totalCents: number; count: number }[],
): string {
  /* istanbul ignore next -- @preserve defensive: formatReportBlocks skips empty sections */
  if (rows.length === 0) return '_None_'

  const truncatedRows = rows.map((r) => ({
    ...r,
    label: truncateLabel(r.label),
  }))
  const labelWidth = Math.max(...truncatedRows.map((r) => r.label.length), 5)
  const amountWidth = Math.max(
    ...rows.map((r) => formatCents(r.totalCents).length),
    6,
  )

  return truncatedRows
    .map(
      (r) =>
        `\`${pad(r.label, labelWidth)}  ${rpad(formatCents(r.totalCents), amountWidth)}  (${r.count})\``,
    )
    .join('\n')
}

/**
 * Known amount range labels in ascending order.
 */
const AMOUNT_RANGE_ORDER = [
  '$0 - $100',
  '$100 - $500',
  '$500 - $1,000',
  '$1,000 - $10,000',
  '$10,000+',
]

/**
 * Sort amount range rows by their natural ascending order.
 */
function sortAmountRanges(
  rows: { label: string; totalCents: number; count: number }[],
): { label: string; totalCents: number; count: number }[] {
  return [...rows].sort(
    (a, b) =>
      AMOUNT_RANGE_ORDER.indexOf(a.label) - AMOUNT_RANGE_ORDER.indexOf(b.label),
  )
}

/**
 * Format report data as a primary Slack message + thread replies.
 *
 * Primary blocks contain the header and total summary.
 * Each breakdown section becomes a thread reply so the channel stays clean.
 */
export function formatReport(
  data: ReportData,
  period: 'weekly' | 'monthly',
  from: string,
  to: string,
): FormattedReport {
  const periodLabel = period === 'weekly' ? 'Weekly' : 'Monthly'
  const blocks: ReportBlock[] = []
  const threadReplies: ReportThreadReply[] = []

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${periodLabel} Donation Report (${from} - ${to})`,
    },
  })

  // Empty report
  if (data.total.count === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'No donations recorded for this period.' },
    })
    if (data.total.nonUsdExcluded > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_${data.total.nonUsdExcluded} non-USD donation(s) excluded from this report._`,
        },
      })
    }
    return { blocks, threadReplies }
  }

  // Total
  let totalText = `*Total:* ${formatCents(data.total.totalCents)} (${data.total.count} donation${data.total.count === 1 ? '' : 's'})`
  if (data.total.nonUsdExcluded > 0) {
    totalText += `\n_${data.total.nonUsdExcluded} non-USD donation(s) excluded from this report._`
  }

  // Hint about thread details
  totalText += '\n_See thread for breakdown details._'

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: totalText },
  })

  // By Source thread reply
  if (data.bySource.length > 0) {
    threadReplies.push({
      text: 'Breakdown by Source',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*By Source*' } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: formatTable(data.bySource) },
        },
      ],
    })
  }

  // By Campaign thread reply
  if (data.byCampaign.length > 0) {
    threadReplies.push({
      text: 'Breakdown by Campaign',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*By Campaign*' } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: formatTable(data.byCampaign) },
        },
      ],
    })
  }

  // By Amount Range thread reply
  if (data.byAmountRange.length > 0) {
    threadReplies.push({
      text: 'Breakdown by Amount Range',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*By Amount Range*' },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: formatTable(sortAmountRanges(data.byAmountRange)),
          },
        },
      ],
    })
  }

  return { blocks, threadReplies }
}
