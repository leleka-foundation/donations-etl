/**
 * Tests for Wise API response schemas.
 */
import { describe, expect, it } from 'vitest'
import {
  WiseAmountSchema,
  WiseBalanceSchema,
  WiseStatementResponseSchema,
  WiseTransactionDetailsSchema,
  WiseTransactionSchema,
  isDeposit,
} from '../../src/wise/schema'

describe('WiseAmountSchema', () => {
  it('validates amount with currency', () => {
    const amount = { value: 100.5, currency: 'EUR' }
    const result = WiseAmountSchema.safeParse(amount)
    expect(result.success).toBe(true)
  })

  it('rejects missing value', () => {
    const amount = { currency: 'EUR' }
    const result = WiseAmountSchema.safeParse(amount)
    expect(result.success).toBe(false)
  })

  it('rejects missing currency', () => {
    const amount = { value: 100 }
    const result = WiseAmountSchema.safeParse(amount)
    expect(result.success).toBe(false)
  })
})

describe('WiseTransactionDetailsSchema', () => {
  it('validates deposit details', () => {
    const details = {
      type: 'DEPOSIT',
      description: 'Received money from John Doe',
      senderName: 'John Doe',
      senderAccount: 'GB82 WEST 1234 5698 7654 32',
      paymentReference: 'Donation',
    }
    const result = WiseTransactionDetailsSchema.safeParse(details)
    expect(result.success).toBe(true)
  })

  it('validates conversion details', () => {
    const details = {
      type: 'CONVERSION',
      description: 'Converted 100 USD to 85 EUR',
      sourceAmount: { value: 100, currency: 'USD' },
      targetAmount: { value: 85, currency: 'EUR' },
      fee: { value: 0.5, currency: 'USD' },
      rate: 0.85,
    }
    const result = WiseTransactionDetailsSchema.safeParse(details)
    expect(result.success).toBe(true)
  })

  it('validates card transaction details', () => {
    const details = {
      type: 'CARD',
      description: 'Card purchase at Store',
      amount: { value: 50, currency: 'GBP' },
      category: 'Shopping',
      merchant: {
        name: 'Store Name',
        city: 'London',
        country: 'GB',
        category: 'Shopping',
      },
    }
    const result = WiseTransactionDetailsSchema.safeParse(details)
    expect(result.success).toBe(true)
  })

  it('requires type field', () => {
    const details = {
      description: 'Some transaction',
    }
    const result = WiseTransactionDetailsSchema.safeParse(details)
    expect(result.success).toBe(false)
  })
})

describe('WiseTransactionSchema', () => {
  const baseTransaction = {
    type: 'CREDIT',
    date: '2025-01-15T10:30:00.000Z',
    amount: { value: 500, currency: 'EUR' },
    totalFees: { value: 0, currency: 'EUR' },
    details: {
      type: 'DEPOSIT',
      description: 'Donation from supporter',
      senderName: 'Jane Smith',
    },
    runningBalance: { value: 1500, currency: 'EUR' },
    referenceNumber: 'TRANSFER-12345678',
  }

  it('validates a complete credit transaction', () => {
    const result = WiseTransactionSchema.safeParse(baseTransaction)
    expect(result.success).toBe(true)
  })

  it('validates a debit transaction', () => {
    const tx = { ...baseTransaction, type: 'DEBIT' }
    const result = WiseTransactionSchema.safeParse(tx)
    expect(result.success).toBe(true)
  })

  it('rejects invalid transaction type', () => {
    const tx = { ...baseTransaction, type: 'INVALID' }
    const result = WiseTransactionSchema.safeParse(tx)
    expect(result.success).toBe(false)
  })

  it('requires referenceNumber', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit
    const { referenceNumber: _omit, ...txWithoutRef } = baseTransaction
    const result = WiseTransactionSchema.safeParse(txWithoutRef)
    expect(result.success).toBe(false)
  })

  it('allows exchangeDetails to be null', () => {
    const tx = { ...baseTransaction, exchangeDetails: null }
    const result = WiseTransactionSchema.safeParse(tx)
    expect(result.success).toBe(true)
  })

  it('validates exchangeDetails when present', () => {
    const tx = {
      ...baseTransaction,
      exchangeDetails: {
        forAmount: { value: 550, currency: 'USD' },
        rate: 1.1,
      },
    }
    const result = WiseTransactionSchema.safeParse(tx)
    expect(result.success).toBe(true)
  })
})

describe('WiseBalanceSchema', () => {
  it('validates balance with required fields', () => {
    const balance = {
      id: 12345,
      currency: 'EUR',
      amount: { value: 1000, currency: 'EUR' },
    }
    const result = WiseBalanceSchema.safeParse(balance)
    expect(result.success).toBe(true)
  })

  it('validates balance with reservedAmount', () => {
    const balance = {
      id: 12345,
      currency: 'EUR',
      amount: { value: 1000, currency: 'EUR' },
      reservedAmount: { value: 50, currency: 'EUR' },
    }
    const result = WiseBalanceSchema.safeParse(balance)
    expect(result.success).toBe(true)
  })

  it('requires id to be a number', () => {
    const balance = {
      id: 'abc',
      currency: 'EUR',
      amount: { value: 1000, currency: 'EUR' },
    }
    const result = WiseBalanceSchema.safeParse(balance)
    expect(result.success).toBe(false)
  })
})

describe('WiseStatementResponseSchema', () => {
  const validResponse = {
    accountHolder: {
      type: 'PERSONAL',
      firstName: 'John',
      lastName: 'Doe',
      address: {
        addressFirstLine: '123 Main St',
        city: 'London',
        postCode: 'SW1A 1AA',
        countryName: 'United Kingdom',
      },
    },
    issuer: {
      name: 'Wise Payments Limited',
      firstLine: '56 Shoreditch High Street',
      city: 'London',
      postCode: 'E1 6JJ',
      country: 'United Kingdom',
    },
    bankDetails: null,
    transactions: [
      {
        type: 'CREDIT',
        date: '2025-01-15T10:30:00.000Z',
        amount: { value: 500, currency: 'EUR' },
        totalFees: { value: 0, currency: 'EUR' },
        details: {
          type: 'DEPOSIT',
          description: 'Donation',
          senderName: 'Jane Smith',
        },
        runningBalance: { value: 1500, currency: 'EUR' },
        referenceNumber: 'TRANSFER-12345678',
      },
    ],
    endOfStatementBalance: { value: 1500, currency: 'EUR' },
    query: {
      intervalStart: '2025-01-01T00:00:00Z',
      intervalEnd: '2025-01-31T23:59:59Z',
      currency: 'EUR',
      accountId: 64,
    },
  }

  it('validates complete statement response', () => {
    const result = WiseStatementResponseSchema.safeParse(validResponse)
    expect(result.success).toBe(true)
  })

  it('validates business account holder', () => {
    const response = {
      ...validResponse,
      accountHolder: {
        type: 'BUSINESS',
        name: 'Acme Corp',
        address: {
          addressFirstLine: '456 Business Ave',
          city: 'New York',
        },
      },
    }
    const result = WiseStatementResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
  })

  it('validates empty transactions array', () => {
    const response = { ...validResponse, transactions: [] }
    const result = WiseStatementResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
  })

  it('requires query parameters', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit
    const { query: _omit, ...responseWithoutQuery } = validResponse
    const result = WiseStatementResponseSchema.safeParse(responseWithoutQuery)
    expect(result.success).toBe(false)
  })
})

describe('isDeposit', () => {
  const createTransaction = (
    type: 'CREDIT' | 'DEBIT',
    detailsType: string,
  ) => ({
    type,
    date: '2025-01-15T10:30:00.000Z',
    amount: { value: 100, currency: 'EUR' },
    totalFees: { value: 0, currency: 'EUR' },
    details: { type: detailsType, description: 'Test' },
    runningBalance: { value: 100, currency: 'EUR' },
    referenceNumber: 'TEST-123',
  })

  it('returns true for CREDIT + DEPOSIT', () => {
    const tx = createTransaction('CREDIT', 'DEPOSIT')
    expect(isDeposit(tx)).toBe(true)
  })

  it('returns false for DEBIT + DEPOSIT', () => {
    const tx = createTransaction('DEBIT', 'DEPOSIT')
    expect(isDeposit(tx)).toBe(false)
  })

  it('returns false for CREDIT + TRANSFER', () => {
    const tx = createTransaction('CREDIT', 'TRANSFER')
    expect(isDeposit(tx)).toBe(false)
  })

  it('returns false for CREDIT + CONVERSION', () => {
    const tx = createTransaction('CREDIT', 'CONVERSION')
    expect(isDeposit(tx)).toBe(false)
  })

  it('returns false for CREDIT + CARD', () => {
    const tx = createTransaction('CREDIT', 'CARD')
    expect(isDeposit(tx)).toBe(false)
  })

  it('returns false for DEBIT + CARD', () => {
    const tx = createTransaction('DEBIT', 'CARD')
    expect(isDeposit(tx)).toBe(false)
  })
})
