/**
 * Tests for Wise API client.
 */
import { DateTime } from 'luxon'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WISE_BASE_URL, WiseClient } from '../../src/wise/client'

// Mock fetchIPv4
vi.mock('../../src/ipv4-fetch', () => ({
  fetchIPv4:
    vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(),
}))

import { fetchIPv4 } from '../../src/ipv4-fetch'

const mockFetch = vi.mocked(fetchIPv4)

describe('WiseClient', () => {
  const configWithBalanceId = {
    apiToken: 'test-token-123',
    profileId: 12345,
    balanceId: 67890,
  }

  const configWithoutBalanceId = {
    apiToken: 'test-token-123',
    profileId: 12345,
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('uses default base URL when not provided', () => {
      const client = new WiseClient(configWithBalanceId)
      expect(client).toBeDefined()
    })

    it('uses custom base URL when provided', () => {
      const customConfig = {
        ...configWithBalanceId,
        baseUrl: 'https://custom.wise.com',
      }
      const client = new WiseClient(customConfig)
      expect(client).toBeDefined()
    })

    it('allows configuration without balanceId', () => {
      const client = new WiseClient(configWithoutBalanceId)
      expect(client).toBeDefined()
    })
  })

  describe('getBalances', () => {
    const validBalancesResponse = [
      { id: 111, currency: 'EUR', amount: { value: 1000, currency: 'EUR' } },
      { id: 222, currency: 'USD', amount: { value: 500, currency: 'USD' } },
    ]

    it('fetches balances successfully', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(validBalancesResponse), { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.getBalances()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0]?.currency).toBe('EUR')
        expect(result.value[1]?.currency).toBe('USD')
      }

      expect(mockFetch).toHaveBeenCalledWith(
        `${WISE_BASE_URL}/v4/profiles/12345/balances?types=STANDARD`,
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token-123',
            Accept: 'application/json',
          },
        }),
      )
    })

    it('returns error for HTTP 401', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          statusText: 'Unauthorized',
        }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.getBalances()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })

    it('returns error for network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.getBalances()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })

    it('returns error for invalid response schema', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: 'response' }), { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.getBalances()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid response')
      }
    })
  })

  describe('getStatementForBalance', () => {
    const validResponse = {
      accountHolder: {
        type: 'PERSONAL',
        firstName: 'Test',
        lastName: 'User',
      },
      issuer: {
        name: 'Wise Payments Limited',
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
        accountId: 67890,
      },
    }

    it('fetches statement for specific balance', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(validResponse), { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to, 'EUR')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.transactions).toHaveLength(1)
        expect(result.value.transactions[0]?.referenceNumber).toBe(
          'TRANSFER-12345678',
        )
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `${WISE_BASE_URL}/v1/profiles/12345/balance-statements/67890/statement.json`,
        ),
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token-123',
            Accept: 'application/json',
          },
        }),
      )
    })

    it('fetches statement without currency filter', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(validResponse), { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isOk()).toBe(true)
      // URL should not contain currency parameter
      const calledUrl = mockFetch.mock.calls[0]?.[0]
      expect(calledUrl).not.toContain('currency=')
    })

    it('returns error for HTTP 401', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          statusText: 'Unauthorized',
        }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
        expect(result.error.message).toContain('401')
      }
    })

    it('returns error for HTTP 403', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })

    it('returns error for HTTP 429 (rate limit)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Too Many Requests', {
          status: 429,
          statusText: 'Too Many Requests',
        }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('rate_limit')
        expect(result.error.retryable).toBe(true)
      }
    })

    it('returns error for HTTP 500 (retryable)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('api')
        expect(result.error.retryable).toBe(true)
      }
    })

    it('returns error for HTTP 400', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400, statusText: 'Bad Request' }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('api')
        expect(result.error.retryable).toBe(false)
      }
    })

    it('returns error when response.text() rejects', async () => {
      // Create a response where text() rejects
      const badResponse = new Response('', {
        status: 500,
        statusText: 'Internal Server Error',
      })
      vi.spyOn(badResponse, 'text').mockRejectedValueOnce(
        new Error('Failed to read body'),
      )
      mockFetch.mockResolvedValueOnce(badResponse)

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('api')
        expect(result.error.message).toContain('500')
        expect(result.error.message).toContain('Internal Server Error')
      }
    })

    it('uses statusText when error body is empty', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('', { status: 502, statusText: 'Bad Gateway' }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('api')
        expect(result.error.message).toBe('HTTP 502: Bad Gateway')
      }
    })

    it('returns error for network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
        expect(result.error.message).toContain('Network error')
      }
    })

    it('returns error for JSON parse failure', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('not valid json', { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('JSON')
      }
    })

    it('returns error for invalid response schema', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: 'response' }), { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(67890, from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid response')
      }
    })

    it('returns error for invalid date range', async () => {
      const client = new WiseClient(configWithoutBalanceId)
      // Create invalid DateTime objects that return null from toISO()
      const invalidFrom = DateTime.invalid('test invalid date')
      const validTo = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatementForBalance(
        67890,
        invalidFrom,
        validTo,
      )

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid date range')
      }
    })
  })

  describe('getStatement', () => {
    const validResponse = {
      accountHolder: {
        type: 'PERSONAL',
        firstName: 'Test',
        lastName: 'User',
      },
      issuer: {
        name: 'Wise Payments Limited',
      },
      bankDetails: null,
      transactions: [],
      endOfStatementBalance: { value: 1500, currency: 'EUR' },
      query: {
        intervalStart: '2025-01-01T00:00:00Z',
        intervalEnd: '2025-01-31T23:59:59Z',
        currency: 'EUR',
        accountId: 67890,
      },
    }

    it('uses configured balanceId when available', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(validResponse), { status: 200 }),
      )

      const client = new WiseClient(configWithBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatement(from, to)

      expect(result.isOk()).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/balance-statements/67890/'),
        expect.anything(),
      )
    })

    it('returns error when balanceId is not configured', async () => {
      const client = new WiseClient(configWithoutBalanceId)
      const from = DateTime.fromISO('2025-01-01T00:00:00Z')
      const to = DateTime.fromISO('2025-01-31T23:59:59Z')

      const result = await client.getStatement(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('balanceId is required')
      }
    })
  })

  describe('healthCheck', () => {
    const validBalancesResponse = [
      { id: 111, currency: 'EUR', amount: { value: 1000, currency: 'EUR' } },
    ]

    it('succeeds when API is accessible', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(validBalancesResponse), { status: 200 }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.healthCheck()

      expect(result.isOk()).toBe(true)
      // Should call getBalances endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/balances'),
        expect.anything(),
      )
    })

    it('fails when API returns error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          statusText: 'Unauthorized',
        }),
      )

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })

    it('fails when network error occurs', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const client = new WiseClient(configWithoutBalanceId)
      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })
  })
})
