/**
 * Tests for BigQuery types and schemas.
 */
import { describe, expect, it } from 'vitest'
import type { ReportRow } from '../src/types'
import {
  EtlMetricsSchema,
  EtlModeSchema,
  EtlRunSchema,
  EtlStatusSchema,
  ReportRowSchema,
  SourceMetricsSchema,
  WatermarkSchema,
  parseReportRows,
} from '../src/types'

describe('EtlModeSchema', () => {
  it('accepts "daily"', () => {
    expect(EtlModeSchema.parse('daily')).toBe('daily')
  })

  it('accepts "backfill"', () => {
    expect(EtlModeSchema.parse('backfill')).toBe('backfill')
  })

  it('rejects invalid modes', () => {
    expect(() => EtlModeSchema.parse('weekly')).toThrow()
    expect(() => EtlModeSchema.parse('manual')).toThrow()
  })
})

describe('EtlStatusSchema', () => {
  it('accepts "started"', () => {
    expect(EtlStatusSchema.parse('started')).toBe('started')
  })

  it('accepts "succeeded"', () => {
    expect(EtlStatusSchema.parse('succeeded')).toBe('succeeded')
  })

  it('accepts "failed"', () => {
    expect(EtlStatusSchema.parse('failed')).toBe('failed')
  })

  it('rejects invalid statuses', () => {
    expect(() => EtlStatusSchema.parse('running')).toThrow()
    expect(() => EtlStatusSchema.parse('pending')).toThrow()
  })
})

describe('SourceMetricsSchema', () => {
  it('parses complete metrics', () => {
    const metrics = {
      count: 100,
      bytesWritten: 50000,
      durationMs: 5000,
    }

    const result = SourceMetricsSchema.parse(metrics)
    expect(result.count).toBe(100)
    expect(result.bytesWritten).toBe(50000)
    expect(result.durationMs).toBe(5000)
  })

  it('parses minimal metrics (count only)', () => {
    const metrics = { count: 50 }
    const result = SourceMetricsSchema.parse(metrics)

    expect(result.count).toBe(50)
    expect(result.bytesWritten).toBeUndefined()
    expect(result.durationMs).toBeUndefined()
  })

  it('rejects negative count', () => {
    expect(() => SourceMetricsSchema.parse({ count: -1 })).toThrow()
  })

  it('allows zero count', () => {
    const result = SourceMetricsSchema.parse({ count: 0 })
    expect(result.count).toBe(0)
  })
})

describe('EtlMetricsSchema', () => {
  it('parses complete ETL metrics', () => {
    const metrics = {
      sources: {
        mercury: { count: 100, bytesWritten: 50000, durationMs: 3000 },
        paypal: { count: 50, bytesWritten: 25000, durationMs: 2000 },
      },
      totalCount: 150,
      totalDurationMs: 5000,
    }

    const result = EtlMetricsSchema.parse(metrics)
    expect(result.totalCount).toBe(150)
    expect(result.sources.mercury?.count).toBe(100)
    expect(result.sources.paypal?.count).toBe(50)
  })

  it('parses minimal ETL metrics', () => {
    const metrics = {
      sources: {},
      totalCount: 0,
    }

    const result = EtlMetricsSchema.parse(metrics)
    expect(result.totalCount).toBe(0)
    expect(result.sources).toEqual({})
  })

  it('requires sources and totalCount', () => {
    expect(() => EtlMetricsSchema.parse({ totalCount: 100 })).toThrow()
    expect(() => EtlMetricsSchema.parse({ sources: {} })).toThrow()
  })
})

describe('EtlRunSchema', () => {
  it('parses a complete run record', () => {
    const run = {
      run_id: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'daily',
      status: 'succeeded',
      started_at: '2024-01-15T00:00:00Z',
      completed_at: '2024-01-15T00:05:00Z',
      from_ts: '2024-01-14T00:00:00Z',
      to_ts: '2024-01-15T00:00:00Z',
      metrics: {
        sources: {
          mercury: { count: 100 },
        },
        totalCount: 100,
      },
      error_message: null,
    }

    const result = EtlRunSchema.parse(run)
    expect(result.run_id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(result.mode).toBe('daily')
    expect(result.status).toBe('succeeded')
  })

  it('parses a started run (no completion)', () => {
    const run = {
      run_id: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'backfill',
      status: 'started',
      started_at: '2024-01-15T00:00:00Z',
      completed_at: null,
      from_ts: '2024-01-01T00:00:00Z',
      to_ts: '2024-01-31T00:00:00Z',
      metrics: null,
      error_message: null,
    }

    const result = EtlRunSchema.parse(run)
    expect(result.status).toBe('started')
    expect(result.completed_at).toBeNull()
    expect(result.metrics).toBeNull()
  })

  it('parses a failed run with error message', () => {
    const run = {
      run_id: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'daily',
      status: 'failed',
      started_at: '2024-01-15T00:00:00Z',
      completed_at: '2024-01-15T00:01:00Z',
      from_ts: '2024-01-14T00:00:00Z',
      to_ts: '2024-01-15T00:00:00Z',
      metrics: null,
      error_message: 'Connection timeout',
    }

    const result = EtlRunSchema.parse(run)
    expect(result.status).toBe('failed')
    expect(result.error_message).toBe('Connection timeout')
  })

  it('rejects invalid run_id format', () => {
    const run = {
      run_id: 'not-a-uuid',
      mode: 'daily',
      status: 'started',
      started_at: '2024-01-15T00:00:00Z',
      completed_at: null,
      from_ts: null,
      to_ts: null,
      metrics: null,
      error_message: null,
    }

    expect(() => EtlRunSchema.parse(run)).toThrow()
  })
})

describe('WatermarkSchema', () => {
  it('parses a valid watermark', () => {
    const watermark = {
      source: 'mercury',
      last_success_to_ts: '2024-01-15T00:00:00Z',
      updated_at: '2024-01-15T01:00:00Z',
    }

    const result = WatermarkSchema.parse(watermark)
    expect(result.source).toBe('mercury')
    expect(result.last_success_to_ts).toBe('2024-01-15T00:00:00Z')
  })

  it('extracts string from BigQueryTimestamp objects', () => {
    // BigQuery returns TIMESTAMP columns as objects with a .value property
    const watermark = {
      source: 'mercury',
      last_success_to_ts: { value: '2024-01-15T00:00:00.000Z' },
      updated_at: { value: '2024-01-15T01:00:00.000Z' },
    }

    const result = WatermarkSchema.parse(watermark)
    expect(result.source).toBe('mercury')
    expect(result.last_success_to_ts).toBe('2024-01-15T00:00:00.000Z')
    expect(result.updated_at).toBe('2024-01-15T01:00:00.000Z')
  })

  it('handles mixed string and BigQueryTimestamp values', () => {
    const watermark = {
      source: 'paypal',
      last_success_to_ts: { value: '2024-02-01T12:00:00.000Z' },
      updated_at: '2024-02-01T12:30:00Z', // plain string
    }

    const result = WatermarkSchema.parse(watermark)
    expect(result.last_success_to_ts).toBe('2024-02-01T12:00:00.000Z')
    expect(result.updated_at).toBe('2024-02-01T12:30:00Z')
  })

  it('requires all fields', () => {
    expect(() =>
      WatermarkSchema.parse({
        source: 'mercury',
        last_success_to_ts: '2024-01-15T00:00:00Z',
      }),
    ).toThrow()

    expect(() =>
      WatermarkSchema.parse({
        last_success_to_ts: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T01:00:00Z',
      }),
    ).toThrow()
  })
})

describe('ReportRowSchema', () => {
  it('parses a valid total row', () => {
    const row = ReportRowSchema.parse({
      section: 'total',
      label: 'total',
      total_cents: '1234500',
      count: '42',
      non_usd_excluded: '3',
    })
    expect(row.section).toBe('total')
    expect(row.total_cents).toBe(1234500)
    expect(row.count).toBe(42)
    expect(row.non_usd_excluded).toBe(3)
  })

  it('parses a valid by_source row', () => {
    const row = ReportRowSchema.parse({
      section: 'by_source',
      label: 'mercury',
      total_cents: 500000,
      count: 10,
      non_usd_excluded: 0,
    })
    expect(row.section).toBe('by_source')
    expect(row.label).toBe('mercury')
  })

  it('parses a valid by_campaign row', () => {
    const row = ReportRowSchema.parse({
      section: 'by_campaign',
      label: 'Spring Drive',
      total_cents: 800000,
      count: 25,
      non_usd_excluded: 0,
    })
    expect(row.label).toBe('Spring Drive')
  })

  it('parses a valid by_amount_range row', () => {
    const row = ReportRowSchema.parse({
      section: 'by_amount_range',
      label: '$0 - $100',
      total_cents: 150000,
      count: 25,
      non_usd_excluded: 0,
    })
    expect(row.label).toBe('$0 - $100')
  })

  it('coerces string numbers to numbers', () => {
    const row = ReportRowSchema.parse({
      section: 'total',
      label: 'total',
      total_cents: '999',
      count: '5',
      non_usd_excluded: '0',
    })
    expect(row.total_cents).toBe(999)
    expect(row.count).toBe(5)
  })

  it('rejects invalid section', () => {
    expect(() =>
      ReportRowSchema.parse({
        section: 'invalid',
        label: 'x',
        total_cents: 0,
        count: 0,
        non_usd_excluded: 0,
      }),
    ).toThrow()
  })
})

describe('parseReportRows', () => {
  const rows: ReportRow[] = [
    {
      section: 'total',
      label: 'total',
      total_cents: 1500000,
      count: 42,
      non_usd_excluded: 3,
    },
    {
      section: 'by_source',
      label: 'mercury',
      total_cents: 500000,
      count: 10,
      non_usd_excluded: 0,
    },
    {
      section: 'by_source',
      label: 'paypal',
      total_cents: 1000000,
      count: 32,
      non_usd_excluded: 0,
    },
    {
      section: 'by_campaign',
      label: 'Spring Drive',
      total_cents: 800000,
      count: 25,
      non_usd_excluded: 0,
    },
    {
      section: 'by_campaign',
      label: 'Unattributed',
      total_cents: 700000,
      count: 17,
      non_usd_excluded: 0,
    },
    {
      section: 'by_amount_range',
      label: '$0 - $100',
      total_cents: 150000,
      count: 25,
      non_usd_excluded: 0,
    },
    {
      section: 'by_amount_range',
      label: '$100 - $500',
      total_cents: 300000,
      count: 10,
      non_usd_excluded: 0,
    },
  ]

  it('parses total section', () => {
    const data = parseReportRows(rows)
    expect(data.total.totalCents).toBe(1500000)
    expect(data.total.count).toBe(42)
    expect(data.total.nonUsdExcluded).toBe(3)
  })

  it('parses by_source section', () => {
    const data = parseReportRows(rows)
    expect(data.bySource).toHaveLength(2)
    expect(data.bySource[0]).toEqual({
      label: 'mercury',
      totalCents: 500000,
      count: 10,
    })
    expect(data.bySource[1]).toEqual({
      label: 'paypal',
      totalCents: 1000000,
      count: 32,
    })
  })

  it('parses by_campaign section', () => {
    const data = parseReportRows(rows)
    expect(data.byCampaign).toHaveLength(2)
    expect(data.byCampaign[0]?.label).toBe('Spring Drive')
  })

  it('parses by_amount_range section', () => {
    const data = parseReportRows(rows)
    expect(data.byAmountRange).toHaveLength(2)
    expect(data.byAmountRange[0]?.label).toBe('$0 - $100')
  })

  it('handles empty rows', () => {
    const data = parseReportRows([])
    expect(data.total.totalCents).toBe(0)
    expect(data.total.count).toBe(0)
    expect(data.total.nonUsdExcluded).toBe(0)
    expect(data.bySource).toEqual([])
    expect(data.byCampaign).toEqual([])
    expect(data.byAmountRange).toEqual([])
  })

  it('handles rows with only total', () => {
    const data = parseReportRows([
      {
        section: 'total',
        label: 'total',
        total_cents: 0,
        count: 0,
        non_usd_excluded: 0,
      },
    ])
    expect(data.total.count).toBe(0)
    expect(data.bySource).toEqual([])
  })
})
