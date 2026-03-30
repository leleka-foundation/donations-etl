/**
 * Tests for report SQL generation.
 */
import { describe, expect, it } from 'vitest'
import { generateReportSql } from '../src/report-sql'
import type { BigQueryConfig } from '../src/types'

describe('generateReportSql', () => {
  const config: BigQueryConfig = {
    projectId: 'test-project',
    datasetRaw: 'donations_raw',
    datasetCanon: 'donations',
  }

  it('uses the canonical dataset', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain('`donations.events`')
  })

  it('uses different dataset names when config differs', () => {
    const sql = generateReportSql({
      ...config,
      datasetCanon: 'my_donations',
    })
    expect(sql).toContain('`my_donations.events`')
    expect(sql).not.toContain('`donations.events`')
  })

  it('filters to succeeded status', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("status = 'succeeded'")
  })

  it('uses named parameters for date range', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain('TIMESTAMP(@from_ts)')
    expect(sql).toContain('TIMESTAMP(@to_ts)')
  })

  it('filters to USD currency', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("currency = 'USD'")
  })

  it('counts non-USD donations excluded', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("currency != 'USD'")
    expect(sql).toContain('non_usd_excluded')
  })

  it('includes total section', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("'total' AS section")
    expect(sql).toContain('SUM(amount_cents)')
    expect(sql).toContain('COUNT(*)')
  })

  it('includes by_source section with GROUP BY', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("'by_source' AS section")
    expect(sql).toContain('source AS label')
    expect(sql).toContain('GROUP BY source')
  })

  it('includes by_campaign section with COALESCE for null attribution', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("'by_campaign' AS section")
    expect(sql).toContain("COALESCE(attribution_human, 'Unattributed')")
    expect(sql).toContain('LIMIT 15')
  })

  it('includes by_amount_range section with correct buckets', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain("'by_amount_range' AS section")
    expect(sql).toContain("'$0 - $100'")
    expect(sql).toContain("'$100 - $500'")
    expect(sql).toContain("'$500 - $1,000'")
    expect(sql).toContain("'$1,000 - $10,000'")
    expect(sql).toContain("'$10,000+'")
  })

  it('uses UNION ALL to combine all sections', () => {
    const sql = generateReportSql(config)
    const unionCount = (sql.match(/UNION ALL/g) ?? []).length
    expect(unionCount).toBe(3) // 4 sections = 3 UNION ALLs
  })

  it('orders by_source and by_campaign by total_cents DESC', () => {
    const sql = generateReportSql(config)
    // Both sections order by total_cents DESC
    expect(sql).toContain('ORDER BY total_cents DESC')
  })

  it('orders by_amount_range by minimum amount ASC', () => {
    const sql = generateReportSql(config)
    expect(sql).toContain('ORDER BY MIN(amount_cents) ASC')
  })
})
