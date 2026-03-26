/**
 * Tests for Venmo CSV schema validation.
 */
import { describe, expect, it } from 'vitest'
import {
  VenmoCsvRowSchema,
  isValidDonation,
  stripTransactionIdQuotes,
} from '../../src/venmo/schema'

describe('VenmoCsvRowSchema', () => {
  const validRow = {
    'Transaction ID': '"""4235629069058725679"""',
    Date: '01/01/2025',
    'Time (UTC)': '01:18:52',
    Type: 'Payment',
    Status: 'Complete',
    Note: 'Donation',
    From: 'john doe',
    'Donor email': 'donor@example.com',
    To: 'Test Organization',
    'Amount (total)': '+ $1,000.00',
    'Amount (tip)': '0',
    'Amount (tax)': '0',
    'Amount (net)': '$980.90',
    'Amount (fee)': '$19.10',
    'Tax Rate': '0',
    'Tax Exempt': 'FALSE',
    'Funding Source': '(None)',
    Destination: 'Venmo balance',
    'Beginning Balance': '0',
    'Ending Balance': '0',
    'Statement Period Venmo Fees': '0',
    'Terminal Location': 'Venmo',
    'Year to Date Venmo Fees': '0',
    Disclaimer: '(None)',
  }

  it('validates a complete valid row', () => {
    const result = VenmoCsvRowSchema.safeParse(validRow)
    expect(result.success).toBe(true)
  })

  it('requires Transaction ID', () => {
    const row = { ...validRow, 'Transaction ID': '' }
    const result = VenmoCsvRowSchema.safeParse(row)
    expect(result.success).toBe(false)
  })

  it('requires Date', () => {
    const row = { ...validRow, Date: '' }
    const result = VenmoCsvRowSchema.safeParse(row)
    expect(result.success).toBe(false)
  })

  it('requires Time (UTC)', () => {
    const row = { ...validRow, 'Time (UTC)': '' }
    const result = VenmoCsvRowSchema.safeParse(row)
    expect(result.success).toBe(false)
  })

  it('requires Type', () => {
    const row = { ...validRow, Type: '' }
    const result = VenmoCsvRowSchema.safeParse(row)
    expect(result.success).toBe(false)
  })

  it('requires Status', () => {
    const row = { ...validRow, Status: '' }
    const result = VenmoCsvRowSchema.safeParse(row)
    expect(result.success).toBe(false)
  })

  it('requires Amount (total)', () => {
    const row = { ...validRow, 'Amount (total)': '' }
    const result = VenmoCsvRowSchema.safeParse(row)
    expect(result.success).toBe(false)
  })

  it('defaults optional fields to empty strings', () => {
    const minimalRow = {
      'Transaction ID': '123',
      Date: '01/01/2025',
      'Time (UTC)': '01:00:00',
      Type: 'Payment',
      Status: 'Complete',
      'Amount (total)': '+ $100.00',
    }
    const result = VenmoCsvRowSchema.safeParse(minimalRow)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.Note).toBe('')
      expect(result.data.From).toBe('')
      expect(result.data['Donor email']).toBe('')
    }
  })
})

describe('isValidDonation', () => {
  const baseRow = {
    'Transaction ID': '"123"',
    Date: '01/01/2025',
    'Time (UTC)': '01:00:00',
    Type: 'Payment',
    Status: 'Complete',
    Note: '',
    From: '',
    'Donor email': '',
    To: '',
    'Amount (total)': '+ $100.00',
    'Amount (tip)': '0',
    'Amount (tax)': '0',
    'Amount (net)': '$98.00',
    'Amount (fee)': '$2.00',
    'Tax Rate': '0',
    'Tax Exempt': '',
    'Funding Source': '',
    Destination: '',
    'Beginning Balance': '0',
    'Ending Balance': '0',
    'Statement Period Venmo Fees': '0',
    'Terminal Location': '',
    'Year to Date Venmo Fees': '0',
    Disclaimer: '',
  }

  it('returns true for Payment + Complete + positive amount', () => {
    const parsed = VenmoCsvRowSchema.parse(baseRow)
    expect(isValidDonation(parsed)).toBe(true)
  })

  it('returns false for Standard Transfer', () => {
    const parsed = VenmoCsvRowSchema.parse({
      ...baseRow,
      Type: 'Standard Transfer',
      Status: 'Issued',
      'Amount (total)': '- $100.00',
    })
    expect(isValidDonation(parsed)).toBe(false)
  })

  it('returns false for non-Complete status', () => {
    const parsed = VenmoCsvRowSchema.parse({
      ...baseRow,
      Status: 'Pending',
    })
    expect(isValidDonation(parsed)).toBe(false)
  })

  it('returns false for negative amount', () => {
    const parsed = VenmoCsvRowSchema.parse({
      ...baseRow,
      'Amount (total)': '- $100.00',
    })
    expect(isValidDonation(parsed)).toBe(false)
  })
})

describe('stripTransactionIdQuotes', () => {
  it('strips triple quotes from transaction ID', () => {
    expect(stripTransactionIdQuotes('"""4235629069058725679"""')).toBe(
      '4235629069058725679',
    )
  })

  it('strips double quotes', () => {
    expect(stripTransactionIdQuotes('""123""')).toBe('123')
  })

  it('strips single quotes', () => {
    expect(stripTransactionIdQuotes('"456"')).toBe('456')
  })

  it('handles no quotes', () => {
    expect(stripTransactionIdQuotes('789')).toBe('789')
  })

  it('handles empty string', () => {
    expect(stripTransactionIdQuotes('')).toBe('')
  })
})
