/**
 * Tests for report Block Kit formatter.
 */
import type { ReportData } from '@donations-etl/bq'
import { describe, expect, it } from 'vitest'
import {
  formatCents,
  formatReport,
  type ReportBlock,
  type ReportThreadReply,
} from '../src/report-formatter'

describe('formatCents', () => {
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })

  it('formats small amounts', () => {
    expect(formatCents(1)).toBe('$0.01')
    expect(formatCents(99)).toBe('$0.99')
  })

  it('formats whole dollars', () => {
    expect(formatCents(100)).toBe('$1.00')
    expect(formatCents(10000)).toBe('$100.00')
  })

  it('formats with commas for thousands', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(1234567)).toBe('$12,345.67')
    expect(formatCents(100000000)).toBe('$1,000,000.00')
  })

  it('formats negative amounts', () => {
    expect(formatCents(-500)).toBe('$-5.00')
  })
})

describe('formatReport', () => {
  const fullData: ReportData = {
    total: { totalCents: 1500000, count: 42, nonUsdExcluded: 3 },
    bySource: [
      { label: 'mercury', totalCents: 500000, count: 10 },
      { label: 'paypal', totalCents: 700000, count: 20 },
      { label: 'givebutter', totalCents: 300000, count: 12 },
    ],
    byCampaign: [
      { label: 'Spring Drive', totalCents: 800000, count: 25 },
      { label: 'Unattributed', totalCents: 700000, count: 17 },
    ],
    byAmountRange: [
      { label: '$0 - $100', totalCents: 150000, count: 25 },
      { label: '$100 - $500', totalCents: 300000, count: 10 },
      { label: '$500 - $1,000', totalCents: 200000, count: 3 },
      { label: '$1,000 - $10,000', totalCents: 850000, count: 4 },
    ],
  }

  function getBlockTexts(blocks: ReportBlock[]): string[] {
    return blocks
      .filter(
        (
          b,
        ): b is {
          type: 'section'
          text: { type: 'mrkdwn'; text: string }
        } => b.type === 'section',
      )
      .map((b) => b.text.text)
  }

  function getReplyTexts(replies: ReportThreadReply[]): string[] {
    return replies.flatMap((r) => getBlockTexts(r.blocks))
  }

  it('includes a header with period and dates', () => {
    const { blocks } = formatReport(fullData, 'weekly', 'Mar 23', 'Mar 30')
    const header = blocks[0]
    expect(header?.type).toBe('header')
    if (header?.type === 'header') {
      expect(header.text.text).toContain('Weekly')
      expect(header.text.text).toContain('Mar 23')
      expect(header.text.text).toContain('Mar 30')
    }
  })

  it('uses Monthly for monthly period', () => {
    const { blocks } = formatReport(fullData, 'monthly', 'Mar 1', 'Mar 31')
    const header = blocks[0]
    if (header?.type === 'header') {
      expect(header.text.text).toContain('Monthly')
    }
  })

  it('includes total with formatted amount and count in primary blocks', () => {
    const { blocks } = formatReport(fullData, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getBlockTexts(blocks)
    const totalText = texts.find((t) => t.includes('Total'))
    expect(totalText).toContain('$15,000.00')
    expect(totalText).toContain('42 donations')
  })

  it('uses singular "donation" for count of 1', () => {
    const data: ReportData = {
      ...fullData,
      total: { totalCents: 10000, count: 1, nonUsdExcluded: 0 },
    }
    const { blocks } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getBlockTexts(blocks)
    const totalText = texts.find((t) => t.includes('Total'))
    expect(totalText).toContain('1 donation)')
    expect(totalText).not.toContain('1 donations')
  })

  it('includes non-USD exclusion note in total block', () => {
    const { blocks } = formatReport(fullData, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getBlockTexts(blocks)
    const totalText = texts.find((t) => t.includes('Total'))
    expect(totalText).toContain('3 non-USD donation(s)')
  })

  it('omits non-USD note when zero excluded', () => {
    const data: ReportData = {
      ...fullData,
      total: { totalCents: 1500000, count: 42, nonUsdExcluded: 0 },
    }
    const { blocks } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getBlockTexts(blocks)
    const totalText = texts.find((t) => t.includes('Total'))
    expect(totalText).not.toContain('non-USD')
  })

  it('includes thread hint in primary message', () => {
    const { blocks } = formatReport(fullData, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getBlockTexts(blocks)
    expect(texts.some((t) => t.includes('thread'))).toBe(true)
  })

  it('creates three thread replies for full data', () => {
    const { threadReplies } = formatReport(
      fullData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    expect(threadReplies).toHaveLength(3)
  })

  it('includes source breakdown in first thread reply', () => {
    const { threadReplies } = formatReport(
      fullData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    expect(threadReplies[0]).toBeDefined()
    const texts = getBlockTexts(threadReplies[0]?.blocks ?? [])
    expect(texts.some((t) => t.includes('By Source'))).toBe(true)
    expect(texts.some((t) => t.includes('mercury'))).toBe(true)
    expect(texts.some((t) => t.includes('paypal'))).toBe(true)
  })

  it('includes campaign breakdown in second thread reply', () => {
    const { threadReplies } = formatReport(
      fullData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    expect(threadReplies[1]).toBeDefined()
    const texts = getBlockTexts(threadReplies[1]?.blocks ?? [])
    expect(texts.some((t) => t.includes('By Campaign'))).toBe(true)
    expect(texts.some((t) => t.includes('Spring Drive'))).toBe(true)
  })

  it('includes amount range breakdown in third thread reply', () => {
    const { threadReplies } = formatReport(
      fullData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    expect(threadReplies[2]).toBeDefined()
    const texts = getBlockTexts(threadReplies[2]?.blocks ?? [])
    expect(texts.some((t) => t.includes('By Amount Range'))).toBe(true)
    expect(texts.some((t) => t.includes('$0 - $100'))).toBe(true)
  })

  it('sets fallback text on each thread reply', () => {
    const { threadReplies } = formatReport(
      fullData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    expect(threadReplies[0]?.text).toContain('Source')
    expect(threadReplies[1]?.text).toContain('Campaign')
    expect(threadReplies[2]?.text).toContain('Amount Range')
  })

  it('has no breakdowns in primary blocks', () => {
    const { blocks } = formatReport(fullData, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getBlockTexts(blocks)
    expect(texts.some((t) => t.includes('By Source'))).toBe(false)
    expect(texts.some((t) => t.includes('By Campaign'))).toBe(false)
    expect(texts.some((t) => t.includes('By Amount Range'))).toBe(false)
  })

  it('handles empty report with friendly message', () => {
    const emptyData: ReportData = {
      total: { totalCents: 0, count: 0, nonUsdExcluded: 0 },
      bySource: [],
      byCampaign: [],
      byAmountRange: [],
    }
    const { blocks, threadReplies } = formatReport(
      emptyData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    const texts = getBlockTexts(blocks)
    expect(texts.some((t) => t.includes('No donations recorded'))).toBe(true)
    expect(threadReplies).toHaveLength(0)
  })

  it('shows non-USD note even in empty report', () => {
    const emptyWithNonUsd: ReportData = {
      total: { totalCents: 0, count: 0, nonUsdExcluded: 5 },
      bySource: [],
      byCampaign: [],
      byAmountRange: [],
    }
    const { blocks } = formatReport(
      emptyWithNonUsd,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    const texts = getBlockTexts(blocks)
    expect(texts.some((t) => t.includes('5 non-USD'))).toBe(true)
  })

  it('omits source reply when empty', () => {
    const data: ReportData = { ...fullData, bySource: [] }
    const { threadReplies } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getReplyTexts(threadReplies)
    expect(texts.some((t) => t.includes('By Source'))).toBe(false)
  })

  it('omits campaign reply when empty', () => {
    const data: ReportData = { ...fullData, byCampaign: [] }
    const { threadReplies } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getReplyTexts(threadReplies)
    expect(texts.some((t) => t.includes('By Campaign'))).toBe(false)
  })

  it('omits amount range reply when empty', () => {
    const data: ReportData = { ...fullData, byAmountRange: [] }
    const { threadReplies } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getReplyTexts(threadReplies)
    expect(texts.some((t) => t.includes('By Amount Range'))).toBe(false)
  })

  it('sorts amount ranges in ascending order regardless of input order', () => {
    const data: ReportData = {
      ...fullData,
      byAmountRange: [
        { label: '$1,000 - $10,000', totalCents: 500000, count: 2 },
        { label: '$0 - $100', totalCents: 100000, count: 20 },
        { label: '$10,000+', totalCents: 2000000, count: 1 },
        { label: '$100 - $500', totalCents: 300000, count: 5 },
      ],
    }
    const { threadReplies } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const rangeReply = threadReplies.find((r) =>
      getBlockTexts(r.blocks).some((t) => t.includes('By Amount Range')),
    )
    expect(rangeReply).toBeDefined()
    const rangeTable = getBlockTexts(rangeReply?.blocks ?? []).find((t) =>
      t.includes('$0 - $100'),
    )
    expect(rangeTable).toBeDefined()
    const lines = (rangeTable ?? '').split('\n')
    expect(lines[0]).toContain('$0 - $100')
    expect(lines[1]).toContain('$100 - $500')
    expect(lines[2]).toContain('$1,000 - $10,000')
    expect(lines[3]).toContain('$10,000+')
  })

  it('truncates long campaign labels with ellipsis', () => {
    const data: ReportData = {
      ...fullData,
      byCampaign: [
        {
          label: 'This is a very long campaign name that should be truncated',
          totalCents: 800000,
          count: 25,
        },
        { label: 'Short', totalCents: 200000, count: 5 },
      ],
    }
    const { threadReplies } = formatReport(data, 'weekly', 'Mar 23', 'Mar 30')
    const texts = getReplyTexts(threadReplies)
    const campaignTable = texts.find((t) => t.includes('Short'))
    expect(campaignTable).toBeDefined()
    expect(campaignTable).toContain('…')
    expect(campaignTable).not.toContain('that should be truncated')
  })

  it('formats table rows with monospace backticks', () => {
    const { threadReplies } = formatReport(
      fullData,
      'weekly',
      'Mar 23',
      'Mar 30',
    )
    const texts = getReplyTexts(threadReplies)
    const sourceTable = texts.find((t) => t.includes('mercury'))
    expect(sourceTable).toContain('`')
  })
})
