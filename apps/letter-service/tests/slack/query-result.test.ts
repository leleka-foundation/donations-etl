/**
 * Tests for query result Slack formatter.
 */
import { describe, expect, it } from 'vitest'
import {
  formatQueryError,
  formatQueryResult,
} from '../../src/slack/formatters/query-result'

describe('formatQueryResult', () => {
  it('includes explanation in blocks', () => {
    const { blocks } = formatQueryResult(
      [{ total: 5000 }],
      'Total donations in dollars',
      'SELECT SUM(amount_cents)/100 FROM events',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts[0]).toBe('Total donations in dollars')
  })

  it('handles no results', () => {
    const { blocks } = formatQueryResult(
      [],
      'Query returned no results',
      'SELECT 1 WHERE FALSE',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('No results'))).toBe(true)
  })

  it('displays single-row aggregation prominently', () => {
    const { blocks } = formatQueryResult(
      [{ total_dollars: 15000, count: 42 }],
      'Total this year',
      'SELECT SUM(...)',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('*total_dollars:*'))).toBe(true)
    expect(texts.some((t) => t.includes('15000'))).toBe(true)
    expect(texts.some((t) => t.includes('42'))).toBe(true)
  })

  it('formats multiple rows as a table', () => {
    const rows = [
      { source: 'mercury', total: 5000 },
      { source: 'paypal', total: 3000 },
      { source: 'givebutter', total: 2000 },
    ]
    const { blocks } = formatQueryResult(rows, 'By source', 'SELECT ...')
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    const table = texts.find((t) => t.includes('mercury'))
    expect(table).toBeDefined()
    expect(table).toContain('paypal')
    expect(table).toContain('givebutter')
    expect(table).toContain('`') // monospace formatting
  })

  it('truncates results beyond MAX_DISPLAY_ROWS', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      name: `donor_${i}`,
    }))
    const { blocks } = formatQueryResult(rows, 'All donors', 'SELECT ...')
    const contextBlocks = blocks.filter((b) => b.type === 'context')
    expect(contextBlocks.length).toBe(1)
    const ctx = contextBlocks[0]
    if (ctx?.type === 'context') {
      expect(ctx.elements[0]?.text).toContain('15 of 20')
    }
  })

  it('puts SQL in thread blocks', () => {
    const { threadBlocks } = formatQueryResult(
      [{ x: 1 }],
      'test',
      'SELECT x FROM events',
    )
    expect(threadBlocks.length).toBe(1)
    const text =
      threadBlocks[0]?.type === 'section' ? threadBlocks[0].text.text : ''
    expect(text).toContain('Generated SQL')
    expect(text).toContain('SELECT x FROM events')
  })

  it('sets fallback text to explanation', () => {
    const { text } = formatQueryResult([{ x: 1 }], 'My explanation', 'SELECT 1')
    expect(text).toBe('My explanation')
  })

  it('handles null values with em dash', () => {
    const { blocks } = formatQueryResult(
      [{ name: null, amount: 100 }],
      'test',
      'SELECT ...',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('—'))).toBe(true)
  })

  it('handles boolean values', () => {
    const { blocks } = formatQueryResult(
      [{ name: 'test', active: true }],
      'test',
      'SELECT ...',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('true'))).toBe(true)
  })

  it('truncates long column values', () => {
    const { blocks } = formatQueryResult(
      [
        {
          name: 'This is a very long donor name that exceeds the column width limit',
          amount: 100,
        },
        {
          name: 'Short name',
          amount: 200,
        },
      ],
      'test',
      'SELECT ...',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('…'))).toBe(true)
  })

  it('right-aligns numeric string values', () => {
    const rows = [
      { source: 'mercury', total: '5,000.00' },
      { source: 'paypal', total: '3,000.00' },
    ]
    const { blocks } = formatQueryResult(rows, 'By source', 'SELECT ...')
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    // Numeric strings should be right-aligned (spaces before the number)
    expect(texts.some((t) => t.includes('5,000.00'))).toBe(true)
  })

  it('left-aligns non-numeric non-string values', () => {
    const rows = [
      { name: 'test', flag: true },
      { name: 'test2', flag: false },
    ]
    const { blocks } = formatQueryResult(rows, 'With booleans', 'SELECT ...')
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('true'))).toBe(true)
  })

  it('handles object values as JSON', () => {
    const { blocks } = formatQueryResult(
      [{ name: 'test', address: { city: 'NYC' }, amount: 100 }],
      'test',
      'SELECT ...',
    )
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('NYC'))).toBe(true)
  })

  it('handles single row with many columns as table', () => {
    const { blocks } = formatQueryResult(
      [{ a: 1, b: 2, c: 3, d: 4 }],
      'test',
      'SELECT ...',
    )
    // 4 columns = should be table format, not prominent display
    const texts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(texts.some((t) => t.includes('`'))).toBe(true)
  })
})

describe('formatQueryError', () => {
  it('includes error message', () => {
    const { blocks, text } = formatQueryError('Something went wrong')
    const sectionTexts = blocks
      .filter(
        (b): b is { type: 'section'; text: { type: 'mrkdwn'; text: string } } =>
          b.type === 'section',
      )
      .map((b) => b.text.text)
    expect(sectionTexts[0]).toContain('Something went wrong')
    expect(text).toContain('Something went wrong')
  })

  it('has no thread blocks', () => {
    const { threadBlocks } = formatQueryError('error')
    expect(threadBlocks).toHaveLength(0)
  })
})
