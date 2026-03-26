/**
 * Tests for Mercury API client.
 */
import { DateTime } from 'luxon'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MERCURY_BASE_URL,
  MERCURY_DEFAULT_PAGE_SIZE,
  MercuryClient,
} from '../../src/mercury/client'
import type { MercuryConfig } from '../../src/types'

// Mock the ipv4-fetch module to use regular fetch in tests
vi.mock('../../src/ipv4-fetch', () => ({
  fetchIPv4: vi.fn((url: string, init?: RequestInit) => fetch(url, init)),
}))

import { fetchIPv4 } from '../../src/ipv4-fetch'

describe('MercuryClient', () => {
  const config: MercuryConfig = {
    apiKey: 'test_api_key_12345',
    baseUrl: 'https://api.mercury.com',
  }

  let client: MercuryClient
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    client = new MercuryClient(config)
    // Mock the fetchIPv4 function
    fetchSpy = vi.mocked(fetchIPv4)
    fetchSpy.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('uses provided baseUrl', () => {
      const customClient = new MercuryClient({
        apiKey: 'key',
        baseUrl: 'https://custom.api.com',
      })
      expect(customClient).toBeDefined()
    })

    it('uses default baseUrl when not provided', () => {
      const defaultClient = new MercuryClient({ apiKey: 'key' })
      expect(defaultClient).toBeDefined()
    })
  })

  describe('getAccounts', () => {
    it('fetches accounts successfully', async () => {
      const mockResponse = {
        accounts: [
          { id: 'acc_1', name: 'Checking', status: 'active', type: 'checking' },
          { id: 'acc_2', name: 'Savings', status: 'active', type: 'savings' },
        ],
      }

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

      const result = await client.getAccounts()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.accounts).toHaveLength(2)
        const firstAccount = result.value.accounts[0]
        expect(firstAccount?.id).toBe('acc_1')
      }

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.mercury.com/api/v1/accounts',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer test_api_key_12345',
            Accept: 'application/json',
          },
        }),
      )
    })

    it('returns error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
        }),
      )

      const result = await client.getAccounts()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
        expect(result.error.source).toBe('mercury')
        expect(result.error.statusCode).toBe(401)
      }
    })

    it('returns error on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'))

      const result = await client.getAccounts()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
        expect(result.error.message).toContain('Network error')
      }
    })

    it('returns error on invalid response shape', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: 'response' }), { status: 200 }),
      )

      const result = await client.getAccounts()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        // Validation errors are classified as network errors (no status code)
        expect(result.error.type).toBe('network')
      }
    })

    it('returns error when response JSON parsing fails', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('not valid json', { status: 200 }),
      )

      const result = await client.getAccounts()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })

    it('returns error with generic message when JSON parse throws non-Error', async () => {
      const badResponse = new Response('', { status: 200 })
      vi.spyOn(badResponse, 'json').mockRejectedValueOnce('string error')
      fetchSpy.mockResolvedValueOnce(badResponse)

      const result = await client.getAccounts()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to parse response JSON')
      }
    })
  })

  describe('getTransactions', () => {
    const accountId = 'acc_12345'
    const from = DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' })
    const to = DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' })

    const mockTransactionResponse = {
      total: 2,
      transactions: [
        {
          id: 'tx_1',
          amount: 1000,
          bankDescription: 'Wire from client',
          counterpartyId: 'cp_1',
          counterpartyName: 'Client A',
          createdAt: '2024-01-15T10:00:00Z',
          status: 'sent',
          kind: 'domesticWire',
        },
        {
          id: 'tx_2',
          amount: 500,
          bankDescription: 'ACH deposit',
          counterpartyId: 'cp_2',
          counterpartyName: 'Client B',
          createdAt: '2024-01-20T14:30:00Z',
          status: 'sent',
          kind: 'externalTransfer',
        },
      ],
    }

    it('fetches transactions successfully', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionResponse), { status: 200 }),
      )

      const result = await client.getTransactions(accountId, from, to)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.total).toBe(2)
        expect(result.value.transactions).toHaveLength(2)
      }
    })

    it('includes date range in query params', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionResponse), { status: 200 }),
      )

      await client.getTransactions(accountId, from, to)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('start=2024-01-01'),
        expect.anything(),
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('end=2024-01-31'),
        expect.anything(),
      )
    })

    it('includes offset and limit in query params', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionResponse), { status: 200 }),
      )

      await client.getTransactions(accountId, from, to, {
        offset: 50,
        limit: 100,
      })

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('offset=50'),
        expect.anything(),
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('limit=100'),
        expect.anything(),
      )
    })

    it('uses default pagination values', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionResponse), { status: 200 }),
      )

      await client.getTransactions(accountId, from, to)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('offset=0'),
        expect.anything(),
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`limit=${MERCURY_DEFAULT_PAGE_SIZE}`),
        expect.anything(),
      )
    })

    it('returns error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Account not found' }), {
          status: 404,
        }),
      )

      const result = await client.getTransactions(accountId, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(404)
      }
    })

    it('returns error on rate limit', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Rate limited' }), {
          status: 429,
          headers: { 'Retry-After': '60' },
        }),
      )

      const result = await client.getTransactions(accountId, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(429)
        expect(result.error.retryable).toBe(true)
      }
    })
  })

  describe('healthCheck', () => {
    it('returns ok when accounts endpoint responds', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ accounts: [] }), { status: 200 }),
      )

      const result = await client.healthCheck()

      expect(result.isOk()).toBe(true)
    })

    it('returns error when API is unreachable', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
    })

    it('returns error on authentication failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Invalid API key' }), {
          status: 401,
        }),
      )

      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(401)
      }
    })
  })
})

describe('MERCURY_BASE_URL', () => {
  it('is the correct Mercury API URL', () => {
    expect(MERCURY_BASE_URL).toBe('https://api.mercury.com')
  })
})

describe('MERCURY_DEFAULT_PAGE_SIZE', () => {
  it('is a reasonable default', () => {
    expect(MERCURY_DEFAULT_PAGE_SIZE).toBeGreaterThan(0)
    expect(MERCURY_DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(500)
  })
})
