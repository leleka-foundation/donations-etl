/**
 * Tests for letter types and schemas.
 */
import { describe, expect, it } from 'vitest'
import {
  DonationRowSchema,
  LetterRequestSchema,
  createLetterError,
} from '../src/types'

describe('DonationRowSchema', () => {
  it('parses a valid donation row', () => {
    const row = {
      event_ts: { value: '2025-01-15T10:30:00Z' },
      amount: 100.0,
      currency: 'USD',
      source: 'paypal',
      status: 'succeeded',
      donor_name: 'Jane Doe',
      donor_email: 'jane@example.com',
    }

    const result = DonationRowSchema.parse(row)

    expect(result.event_ts.value).toBe('2025-01-15T10:30:00Z')
    expect(result.amount).toBe(100.0)
    expect(result.currency).toBe('USD')
    expect(result.source).toBe('paypal')
    expect(result.status).toBe('succeeded')
    expect(result.donor_name).toBe('Jane Doe')
    expect(result.donor_email).toBe('jane@example.com')
  })

  it('accepts null donor_name and donor_email', () => {
    const row = {
      event_ts: { value: '2025-01-15T10:30:00Z' },
      amount: 50.0,
      currency: 'EUR',
      source: 'mercury',
      status: 'succeeded',
      donor_name: null,
      donor_email: null,
    }

    const result = DonationRowSchema.parse(row)

    expect(result.donor_name).toBeNull()
    expect(result.donor_email).toBeNull()
  })

  it('rejects invalid currency length', () => {
    const row = {
      event_ts: { value: '2025-01-15T10:30:00Z' },
      amount: 100.0,
      currency: 'US',
      source: 'paypal',
      status: 'succeeded',
      donor_name: 'Jane Doe',
      donor_email: 'jane@example.com',
    }

    expect(() => DonationRowSchema.parse(row)).toThrow()
  })

  it('rejects missing event_ts.value', () => {
    const row = {
      event_ts: {},
      amount: 100.0,
      currency: 'USD',
      source: 'paypal',
      status: 'succeeded',
      donor_name: 'Jane Doe',
      donor_email: 'jane@example.com',
    }

    expect(() => DonationRowSchema.parse(row)).toThrow()
  })

  it('rejects non-number amount', () => {
    const row = {
      event_ts: { value: '2025-01-15T10:30:00Z' },
      amount: 'not-a-number',
      currency: 'USD',
      source: 'paypal',
      status: 'succeeded',
      donor_name: 'Jane Doe',
      donor_email: 'jane@example.com',
    }

    expect(() => DonationRowSchema.parse(row)).toThrow()
  })
})

describe('LetterRequestSchema', () => {
  it('parses a valid request with all fields', () => {
    const request = {
      emails: ['jane@example.com'],
      from: '2024-01-01',
      to: '2024-12-31',
      format: 'pdf',
    }

    const result = LetterRequestSchema.parse(request)

    expect(result.emails).toEqual(['jane@example.com'])
    expect(result.from).toBe('2024-01-01')
    expect(result.to).toBe('2024-12-31')
    expect(result.format).toBe('pdf')
  })

  it('defaults format to pdf', () => {
    const request = {
      emails: ['jane@example.com'],
    }

    const result = LetterRequestSchema.parse(request)

    expect(result.format).toBe('pdf')
    expect(result.from).toBeUndefined()
    expect(result.to).toBeUndefined()
  })

  it('accepts multiple emails', () => {
    const request = {
      emails: ['jane@example.com', 'j.doe@work.org'],
    }

    const result = LetterRequestSchema.parse(request)

    expect(result.emails).toHaveLength(2)
  })

  it('rejects empty emails array', () => {
    const request = {
      emails: [],
    }

    expect(() => LetterRequestSchema.parse(request)).toThrow()
  })

  it('rejects invalid email format', () => {
    const request = {
      emails: ['not-an-email'],
    }

    expect(() => LetterRequestSchema.parse(request)).toThrow()
  })

  it('rejects invalid format value', () => {
    const request = {
      emails: ['jane@example.com'],
      format: 'docx',
    }

    expect(() => LetterRequestSchema.parse(request)).toThrow()
  })

  it('accepts html format', () => {
    const request = {
      emails: ['jane@example.com'],
      format: 'html',
    }

    const result = LetterRequestSchema.parse(request)

    expect(result.format).toBe('html')
  })
})

describe('createLetterError', () => {
  it('creates an error with all fields', () => {
    const cause = new Error('underlying')
    const error = createLetterError('query', 'Query failed', cause)

    expect(error.type).toBe('query')
    expect(error.message).toBe('Query failed')
    expect(error.cause).toBe(cause)
  })

  it('creates an error without cause', () => {
    const error = createLetterError('render', 'Render failed')

    expect(error.type).toBe('render')
    expect(error.message).toBe('Render failed')
    expect(error.cause).toBeUndefined()
  })

  it('supports all error types', () => {
    const types = ['query', 'render', 'pdf', 'validation'] as const

    for (const type of types) {
      const error = createLetterError(type, `${type} error`)
      expect(error.type).toBe(type)
    }
  })
})
