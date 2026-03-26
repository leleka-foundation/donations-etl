/**
 * Tests for the donation query module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock BigQuery before importing the module
const mockQuery =
  vi.fn<(opts: { query: string; params: unknown }) => Promise<[unknown[]]>>()

vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: class MockBigQuery {
    query = mockQuery
  },
}))

import { buildDonationQuery, queryDonations } from '../src/query'

describe('buildDonationQuery', () => {
  it('builds a basic query with emails only', () => {
    const { sql, params } = buildDonationQuery(['jane@example.com'])

    expect(sql).toContain('donor_email IN UNNEST(@emails)')
    expect(sql).toContain("status = 'succeeded'")
    expect(sql).toContain('ORDER BY event_ts ASC')
    expect(sql).not.toContain('@from_date')
    expect(sql).not.toContain('@to_date')
    expect(params).toEqual({ emails: ['jane@example.com'] })
  })

  it('builds a query with from date filter', () => {
    const { sql, params } = buildDonationQuery(
      ['jane@example.com'],
      '2024-01-01',
    )

    expect(sql).toContain('event_ts >= TIMESTAMP(@from_date)')
    expect(sql).not.toContain('@to_date')
    expect(params).toEqual({
      emails: ['jane@example.com'],
      from_date: '2024-01-01',
    })
  })

  it('builds a query with to date filter', () => {
    const { sql, params } = buildDonationQuery(
      ['jane@example.com'],
      undefined,
      '2024-12-31',
    )

    expect(sql).toContain('event_ts < TIMESTAMP(@to_date)')
    expect(sql).not.toContain('@from_date')
    expect(params).toEqual({
      emails: ['jane@example.com'],
      to_date: '2024-12-31',
    })
  })

  it('builds a query with both date filters', () => {
    const { sql, params } = buildDonationQuery(
      ['jane@example.com', 'j.doe@work.org'],
      '2024-01-01',
      '2024-12-31',
    )

    expect(sql).toContain('event_ts >= TIMESTAMP(@from_date)')
    expect(sql).toContain('event_ts < TIMESTAMP(@to_date)')
    expect(params).toEqual({
      emails: ['jane@example.com', 'j.doe@work.org'],
      from_date: '2024-01-01',
      to_date: '2024-12-31',
    })
  })

  it('selects the correct columns', () => {
    const { sql } = buildDonationQuery(['jane@example.com'])

    expect(sql).toContain('event_ts')
    expect(sql).toContain('ROUND(amount_cents / 100, 2) AS amount')
    expect(sql).toContain('currency')
    expect(sql).toContain('source')
    expect(sql).toContain('status')
    expect(sql).toContain('donor_name')
    expect(sql).toContain('donor_email')
  })
})

describe('queryDonations', () => {
  const config = {
    projectId: 'test-project',
    dataset: 'donations',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns validated donation rows on success', async () => {
    const mockRows = [
      {
        event_ts: { value: '2025-01-15T10:30:00Z' },
        amount: 100.0,
        currency: 'USD',
        source: 'paypal',
        status: 'succeeded',
        donor_name: 'Jane Doe',
        donor_email: 'jane@example.com',
      },
      {
        event_ts: { value: '2025-03-20T14:00:00Z' },
        amount: 250.5,
        currency: 'USD',
        source: 'mercury',
        status: 'succeeded',
        donor_name: 'Jane Doe',
        donor_email: 'jane@example.com',
      },
    ]

    mockQuery.mockResolvedValue([mockRows])

    const result = await queryDonations(config, ['jane@example.com'])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toHaveLength(2)
      expect(result.value[0]?.amount).toBe(100.0)
      expect(result.value[1]?.amount).toBe(250.5)
    }
  })

  it('replaces project and dataset in query', async () => {
    mockQuery.mockResolvedValue([[]])

    await queryDonations(config, ['jane@example.com'])

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        query: expect.stringContaining('test-project.donations.events'),
      }),
    )
  })

  it('passes date filters to query', async () => {
    mockQuery.mockResolvedValue([[]])

    await queryDonations(
      config,
      ['jane@example.com'],
      '2024-01-01',
      '2024-12-31',
    )

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        params: expect.objectContaining({
          from_date: '2024-01-01',
          to_date: '2024-12-31',
        }),
      }),
    )
  })

  it('returns empty array when no results', async () => {
    mockQuery.mockResolvedValue([[]])

    const result = await queryDonations(config, ['nobody@example.com'])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual([])
    }
  })

  it('returns query error when BigQuery fails', async () => {
    mockQuery.mockRejectedValue(new Error('Connection refused'))

    const result = await queryDonations(config, ['jane@example.com'])

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('query')
      expect(result.error.message).toContain('Connection refused')
    }
  })

  it('returns validation error for invalid response shape', async () => {
    const invalidRows = [{ bad_field: 'invalid' }]
    mockQuery.mockResolvedValue([invalidRows])

    const result = await queryDonations(config, ['jane@example.com'])

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('validation')
      expect(result.error.message).toContain('Invalid query results')
    }
  })

  it('handles non-Error thrown values', async () => {
    mockQuery.mockRejectedValue('string error')

    const result = await queryDonations(config, ['jane@example.com'])

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('query')
      expect(result.error.message).toContain('string error')
    }
  })
})
