/**
 * Tests for PayPal API schema validation.
 */
import { describe, expect, it } from 'vitest'
import {
  PayPalMoneySchema,
  PayPalPayerInfoSchema,
  PayPalTokenResponseSchema,
  PayPalTransactionDetailSchema,
  PayPalTransactionInfoSchema,
  PayPalTransactionSearchResponseSchema,
} from '../../src/paypal/schema'

describe('PayPalMoneySchema', () => {
  it('parses a valid money object', () => {
    const money = { currency_code: 'USD', value: '100.00' }
    const result = PayPalMoneySchema.parse(money)
    expect(result.currency_code).toBe('USD')
    expect(result.value).toBe('100.00')
  })

  it('rejects invalid currency code length', () => {
    expect(() =>
      PayPalMoneySchema.parse({ currency_code: 'US', value: '100.00' }),
    ).toThrow()
  })
})

describe('PayPalPayerInfoSchema', () => {
  it('parses complete payer info', () => {
    const payerInfo = {
      account_id: 'PAYER123',
      email_address: 'donor@example.com',
      phone_number: {
        country_code: '1',
        national_number: '5551234567',
      },
      payer_name: {
        given_name: 'John',
        surname: 'Doe',
      },
      address: {
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        country_code: 'US',
        postal_code: '94102',
      },
      payer_status: 'Y' as const,
    }

    const result = PayPalPayerInfoSchema.parse(payerInfo)
    expect(result.email_address).toBe('donor@example.com')
    expect(result.payer_name?.given_name).toBe('John')
    expect(result.address?.city).toBe('San Francisco')
  })

  it('parses minimal payer info', () => {
    const result = PayPalPayerInfoSchema.parse({})
    expect(result.account_id).toBeUndefined()
    expect(result.email_address).toBeUndefined()
  })
})

describe('PayPalTransactionInfoSchema', () => {
  it('parses a complete transaction info', () => {
    const txInfo = {
      paypal_account_id: 'MERCHANT123',
      transaction_id: 'TX12345678',
      transaction_event_code: 'T0006',
      transaction_initiation_date: '2024-01-15T10:30:00Z',
      transaction_updated_date: '2024-01-15T10:35:00Z',
      transaction_amount: { currency_code: 'USD', value: '100.00' },
      fee_amount: { currency_code: 'USD', value: '-2.90' },
      transaction_status: 'S' as const,
      transaction_subject: 'Donation to Charity',
      invoice_id: 'INV-001',
    }

    const result = PayPalTransactionInfoSchema.parse(txInfo)
    expect(result.transaction_id).toBe('TX12345678')
    expect(result.transaction_status).toBe('S')
    expect(result.transaction_amount?.value).toBe('100.00')
  })

  it('parses minimal transaction info with only required fields', () => {
    const txInfo = { transaction_id: 'TX12345' }
    const result = PayPalTransactionInfoSchema.parse(txInfo)
    expect(result.transaction_id).toBe('TX12345')
  })

  it('validates transaction status enum', () => {
    const validStatuses = ['D', 'P', 'S', 'V'] as const
    for (const status of validStatuses) {
      const txInfo = { transaction_id: 'TX1', transaction_status: status }
      const result = PayPalTransactionInfoSchema.parse(txInfo)
      expect(result.transaction_status).toBe(status)
    }
  })

  it('rejects invalid transaction status', () => {
    const txInfo = { transaction_id: 'TX1', transaction_status: 'X' }
    expect(() => PayPalTransactionInfoSchema.parse(txInfo)).toThrow()
  })
})

describe('PayPalTransactionDetailSchema', () => {
  it('parses a complete transaction detail', () => {
    const detail = {
      transaction_info: {
        transaction_id: 'TX123',
        transaction_amount: { currency_code: 'USD', value: '50.00' },
        transaction_status: 'S' as const,
      },
      payer_info: {
        email_address: 'payer@example.com',
        payer_name: { given_name: 'Jane', surname: 'Smith' },
      },
      shipping_info: {
        name: 'Jane Smith',
        address: { line1: '456 Oak Ave', city: 'Oakland' },
      },
      cart_info: {
        item_details: [{ item_name: 'Donation', item_quantity: '1' }],
      },
    }

    const result = PayPalTransactionDetailSchema.parse(detail)
    expect(result.transaction_info.transaction_id).toBe('TX123')
    expect(result.payer_info?.email_address).toBe('payer@example.com')
    expect(result.shipping_info?.name).toBe('Jane Smith')
    expect(result.cart_info?.item_details?.[0]?.item_name).toBe('Donation')
  })

  it('parses minimal transaction detail', () => {
    const detail = {
      transaction_info: { transaction_id: 'TX123' },
    }

    const result = PayPalTransactionDetailSchema.parse(detail)
    expect(result.transaction_info.transaction_id).toBe('TX123')
    expect(result.payer_info).toBeUndefined()
  })
})

describe('PayPalTransactionSearchResponseSchema', () => {
  it('parses a response with multiple transactions', () => {
    const response = {
      transaction_details: [
        { transaction_info: { transaction_id: 'TX1' } },
        { transaction_info: { transaction_id: 'TX2' } },
      ],
      account_number: 'ACC123',
      start_date: '2024-01-01T00:00:00Z',
      end_date: '2024-01-31T23:59:59Z',
      page: 1,
      total_items: 50,
      total_pages: 5,
    }

    const result = PayPalTransactionSearchResponseSchema.parse(response)
    expect(result.transaction_details).toHaveLength(2)
    expect(result.total_pages).toBe(5)
    expect(result.page).toBe(1)
  })

  it('parses an empty response', () => {
    const response = {
      transaction_details: [],
    }

    const result = PayPalTransactionSearchResponseSchema.parse(response)
    expect(result.transaction_details).toEqual([])
  })

  it('parses response with links', () => {
    const response = {
      transaction_details: [],
      links: [
        {
          href: 'https://api.paypal.com/v1/reporting/transactions?page=2',
          rel: 'next',
        },
      ],
    }

    const result = PayPalTransactionSearchResponseSchema.parse(response)
    expect(result.links?.[0]?.rel).toBe('next')
  })
})

describe('PayPalTokenResponseSchema', () => {
  it('parses a valid token response', () => {
    const tokenResponse = {
      access_token: 'A21AAHZi...',
      token_type: 'Bearer',
      app_id: 'APP-80W284485P519543T',
      expires_in: 32400,
      scope: 'https://uri.paypal.com/services/reporting/search/read',
      nonce: '2024-01-15T10:30:00Z',
    }

    const result = PayPalTokenResponseSchema.parse(tokenResponse)
    expect(result.access_token).toBe('A21AAHZi...')
    expect(result.token_type).toBe('Bearer')
    expect(result.expires_in).toBe(32400)
  })

  it('parses minimal token response', () => {
    const tokenResponse = {
      access_token: 'TOKEN123',
      token_type: 'Bearer',
      expires_in: 3600,
    }

    const result = PayPalTokenResponseSchema.parse(tokenResponse)
    expect(result.access_token).toBe('TOKEN123')
    expect(result.app_id).toBeUndefined()
  })
})
