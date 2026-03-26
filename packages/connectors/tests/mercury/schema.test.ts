/**
 * Tests for Mercury API schema validation.
 */
import { describe, expect, it } from 'vitest'
import {
  MercuryAccountSchema,
  MercuryAccountsResponseSchema,
  MercuryAddressSchema,
  MercuryDomesticWireRoutingSchema,
  MercuryTransactionDetailsSchema,
  MercuryTransactionSchema,
  MercuryTransactionsResponseSchema,
} from '../../src/mercury/schema'

describe('MercuryAddressSchema', () => {
  it('parses a complete address', () => {
    const address = {
      address1: '123 Main St',
      address2: 'Suite 100',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94102',
    }

    const result = MercuryAddressSchema.parse(address)
    expect(result).toEqual(address)
  })

  it('parses an address with null fields', () => {
    const address = {
      address1: '123 Main St',
      address2: null,
      city: 'San Francisco',
      state: null,
      postalCode: '94102',
    }

    const result = MercuryAddressSchema.parse(address)
    expect(result.address2).toBeNull()
    expect(result.state).toBeNull()
  })

  it('parses an empty address object', () => {
    const result = MercuryAddressSchema.parse({})
    expect(result).toEqual({})
  })
})

describe('MercuryDomesticWireRoutingSchema', () => {
  it('parses complete routing info', () => {
    const routing = {
      bankName: 'Chase Bank',
      accountNumber: '123456789',
      routingNumber: '021000021',
      address: {
        address1: '123 Bank St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
      },
    }

    const result = MercuryDomesticWireRoutingSchema.parse(routing)
    expect(result).toEqual(routing)
  })

  it('parses partial routing info', () => {
    const routing = {
      bankName: 'Chase Bank',
    }

    const result = MercuryDomesticWireRoutingSchema.parse(routing)
    expect(result.bankName).toBe('Chase Bank')
    expect(result.accountNumber).toBeUndefined()
  })
})

describe('MercuryTransactionDetailsSchema', () => {
  it('parses details with top-level address', () => {
    const details = {
      address: {
        address1: '100 Main St',
        city: 'Boston',
        state: 'MA',
        postalCode: '02101',
      },
    }

    const result = MercuryTransactionDetailsSchema.parse(details)
    expect(result.address?.address1).toBe('100 Main St')
  })

  it('parses details with domestic wire routing', () => {
    const details = {
      domesticWireRoutingInfo: {
        bankName: 'Bank of America',
        routingNumber: '026009593',
        address: {
          address1: '100 Bank Plaza',
          city: 'Charlotte',
          state: 'NC',
        },
      },
    }

    const result = MercuryTransactionDetailsSchema.parse(details)
    expect(result.domesticWireRoutingInfo?.bankName).toBe('Bank of America')
  })

  it('parses empty details', () => {
    const result = MercuryTransactionDetailsSchema.parse({})
    expect(result).toEqual({})
  })
})

describe('MercuryTransactionSchema', () => {
  const validTransaction = {
    id: 'tx_12345',
    amount: 1500.5,
    bankDescription: 'Wire transfer from client',
    counterpartyId: 'cp_67890',
    counterpartyName: 'Test Client Inc',
    createdAt: '2024-01-15T10:30:00Z',
    status: 'sent' as const,
    kind: 'domesticWire',
  }

  it('parses a minimal valid transaction', () => {
    const result = MercuryTransactionSchema.parse(validTransaction)

    expect(result.id).toBe('tx_12345')
    expect(result.amount).toBe(1500.5)
    expect(result.bankDescription).toBe('Wire transfer from client')
    expect(result.counterpartyId).toBe('cp_67890')
    expect(result.counterpartyName).toBe('Test Client Inc')
    expect(result.createdAt).toBe('2024-01-15T10:30:00Z')
    expect(result.status).toBe('sent')
    expect(result.kind).toBe('domesticWire')
  })

  it('parses a complete transaction with all optional fields', () => {
    const fullTransaction = {
      ...validTransaction,
      counterpartyNickname: 'Test Client',
      dashboardLink: 'https://app.mercury.com/tx/12345',
      details: {
        address: {
          address1: '123 Client St',
          city: 'Client City',
          state: 'CC',
          postalCode: '12345',
        },
      },
      externalMemo: 'Q1 2024 Payment',
      failedAt: null,
      note: 'Important client',
      postedAt: '2024-01-15T12:00:00Z',
      reasonForFailure: null,
      trackingNumber: 'TRK123',
    }

    const result = MercuryTransactionSchema.parse(fullTransaction)
    expect(result.counterpartyNickname).toBe('Test Client')
    expect(result.dashboardLink).toBe('https://app.mercury.com/tx/12345')
    expect(result.details?.address?.address1).toBe('123 Client St')
    expect(result.externalMemo).toBe('Q1 2024 Payment')
    expect(result.note).toBe('Important client')
    expect(result.postedAt).toBe('2024-01-15T12:00:00Z')
    expect(result.trackingNumber).toBe('TRK123')
  })

  it('accepts negative amounts (debits)', () => {
    const debitTx = { ...validTransaction, amount: -500.25 }
    const result = MercuryTransactionSchema.parse(debitTx)
    expect(result.amount).toBe(-500.25)
  })

  it('validates status string values', () => {
    // Mercury API returns various status values - we accept any string
    const statuses = [
      'pending',
      'sent',
      'cancelled',
      'failed',
      'completed',
    ] as const
    for (const status of statuses) {
      const tx = { ...validTransaction, status }
      const result = MercuryTransactionSchema.parse(tx)
      expect(result.status).toBe(status)
    }
  })

  it('rejects missing required fields', () => {
    // Test missing id
    expect(() =>
      MercuryTransactionSchema.parse({
        ...validTransaction,
        id: undefined,
      }),
    ).toThrow()

    // Test missing counterpartyName
    expect(() =>
      MercuryTransactionSchema.parse({
        ...validTransaction,
        counterpartyName: undefined,
      }),
    ).toThrow()
  })

  it('accepts null for nullable string fields', () => {
    const txWithNulls = {
      ...validTransaction,
      bankDescription: null,
      counterpartyNickname: null,
      externalMemo: null,
      failedAt: null,
      note: null,
      postedAt: null,
      reasonForFailure: null,
      trackingNumber: null,
      details: null,
    }

    const result = MercuryTransactionSchema.parse(txWithNulls)
    expect(result.bankDescription).toBeNull()
    expect(result.note).toBeNull()
  })
})

describe('MercuryTransactionsResponseSchema', () => {
  it('parses a response with multiple transactions', () => {
    const response = {
      total: 2,
      transactions: [
        {
          id: 'tx_1',
          amount: 100,
          bankDescription: 'Test 1',
          counterpartyId: 'cp_1',
          counterpartyName: 'Client 1',
          createdAt: '2024-01-01T00:00:00Z',
          status: 'sent' as const,
          kind: 'ach',
        },
        {
          id: 'tx_2',
          amount: 200,
          bankDescription: 'Test 2',
          counterpartyId: 'cp_2',
          counterpartyName: 'Client 2',
          createdAt: '2024-01-02T00:00:00Z',
          status: 'pending' as const,
          kind: 'wire',
        },
      ],
    }

    const result = MercuryTransactionsResponseSchema.parse(response)
    expect(result.total).toBe(2)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0]?.id).toBe('tx_1')
    expect(result.transactions[1]?.id).toBe('tx_2')
  })

  it('parses an empty response', () => {
    const response = {
      total: 0,
      transactions: [],
    }

    const result = MercuryTransactionsResponseSchema.parse(response)
    expect(result.total).toBe(0)
    expect(result.transactions).toEqual([])
  })
})

describe('MercuryAccountSchema', () => {
  it('parses a minimal account', () => {
    const account = {
      id: 'acc_12345',
      name: 'Operating Account',
      status: 'active',
      type: 'checking',
    }

    const result = MercuryAccountSchema.parse(account)
    expect(result.id).toBe('acc_12345')
    expect(result.name).toBe('Operating Account')
    expect(result.status).toBe('active')
    expect(result.type).toBe('checking')
  })

  it('parses an account with all optional fields', () => {
    const account = {
      id: 'acc_12345',
      name: 'Operating Account',
      status: 'active',
      type: 'checking',
      legalBusinessName: 'Acme Corp LLC',
      currentBalance: 50000.5,
      availableBalance: 48000.25,
    }

    const result = MercuryAccountSchema.parse(account)
    expect(result.legalBusinessName).toBe('Acme Corp LLC')
    expect(result.currentBalance).toBe(50000.5)
    expect(result.availableBalance).toBe(48000.25)
  })
})

describe('MercuryAccountsResponseSchema', () => {
  it('parses a response with multiple accounts', () => {
    const response = {
      accounts: [
        {
          id: 'acc_1',
          name: 'Checking',
          status: 'active',
          type: 'checking',
        },
        {
          id: 'acc_2',
          name: 'Savings',
          status: 'active',
          type: 'savings',
        },
      ],
    }

    const result = MercuryAccountsResponseSchema.parse(response)
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0]?.name).toBe('Checking')
    expect(result.accounts[1]?.name).toBe('Savings')
  })

  it('parses an empty accounts response', () => {
    const response = { accounts: [] }
    const result = MercuryAccountsResponseSchema.parse(response)
    expect(result.accounts).toEqual([])
  })
})
