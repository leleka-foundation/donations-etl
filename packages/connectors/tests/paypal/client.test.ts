/**
 * Tests for PayPal API client.
 */
import { DateTime } from 'luxon'
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  getEarliestAllowedDate,
  PAYPAL_BASE_URL,
  PAYPAL_DEFAULT_PAGE_SIZE,
  PAYPAL_HISTORY_YEARS,
  PAYPAL_SANDBOX_URL,
  PayPalClient,
} from '../../src/paypal/client'
import type { PayPalConfig } from '../../src/types'

describe('PayPalClient', () => {
  const config: PayPalConfig = {
    clientId: 'test_client_id',
    secret: 'test_client_secret',
  }

  let client: PayPalClient
  let fetchSpy: Mock<typeof fetch>

  beforeEach(() => {
    client = new PayPalClient(config)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('uses production URL by default', () => {
      const prodClient = new PayPalClient({ clientId: 'id', secret: 'secret' })
      expect(prodClient).toBeDefined()
    })

    it('uses sandbox URL when sandbox is true', () => {
      const sandboxClient = new PayPalClient({
        clientId: 'id',
        secret: 'secret',
        sandbox: true,
      })
      expect(sandboxClient).toBeDefined()
    })

    it('uses custom baseUrl when provided', () => {
      const customClient = new PayPalClient({
        clientId: 'id',
        secret: 'secret',
        baseUrl: 'https://custom.paypal.com',
      })
      expect(customClient).toBeDefined()
    })
  })

  describe('getTransactions', () => {
    const from = DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' })
    const to = DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' })

    const mockTokenResponse = {
      access_token: 'ACCESS_TOKEN_123',
      token_type: 'Bearer',
      expires_in: 32400,
    }

    const mockTransactionsResponse = {
      transaction_details: [
        {
          transaction_info: {
            transaction_id: 'TX1',
            transaction_amount: { currency_code: 'USD', value: '100.00' },
            transaction_status: 'S',
          },
        },
      ],
      total_items: 1,
      total_pages: 1,
      page: 1,
    }

    it('fetches transactions successfully', async () => {
      // Mock token request
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      // Mock transactions request
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionsResponse), { status: 200 }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.transaction_details).toHaveLength(1)
        expect(
          result.value.transaction_details[0]?.transaction_info.transaction_id,
        ).toBe('TX1')
      }
    })

    it('includes date range and pagination in query params', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionsResponse), { status: 200 }),
      )

      await client.getTransactions(from, to, { page: 2, pageSize: 50 })

      // Check the transactions request URL
      const transactionsCall = fetchSpy.mock.calls[1]
      const url = transactionsCall?.[0]
      expect(url).toContain('start_date=')
      expect(url).toContain('end_date=')
      expect(url).toContain('page=2')
      expect(url).toContain('page_size=50')
    })

    it('uses default pagination values', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionsResponse), { status: 200 }),
      )

      await client.getTransactions(from, to)

      const transactionsCall = fetchSpy.mock.calls[1]
      const url = transactionsCall?.[0]
      expect(url).toContain('page=1')
      expect(url).toContain(`page_size=${PAYPAL_DEFAULT_PAGE_SIZE}`)
    })

    it('returns error on token request failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_client' }), {
          status: 401,
        }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
        expect(result.error.statusCode).toBe(401)
      }
    })

    it('returns error on transactions request failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(404)
      }
    })

    it('caches the access token', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionsResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionsResponse), { status: 200 }),
      )

      // First request gets token
      await client.getTransactions(from, to)
      // Second request should use cached token
      await client.getTransactions(from, to)

      // Should only have called token endpoint once
      const tokenCalls = fetchSpy.mock.calls.filter((call) => {
        const url = call[0]
        return typeof url === 'string' && url.includes('/oauth2/token')
      })
      expect(tokenCalls).toHaveLength(1)
    })

    it('clears token on 401 response', async () => {
      // First request: get token and fetch
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTransactionsResponse), { status: 200 }),
      )

      await client.getTransactions(from, to)

      // Second request: 401 on transactions
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Token expired' }), {
          status: 401,
        }),
      )

      const result = await client.getTransactions(from, to)
      expect(result.isErr()).toBe(true)
    })

    it('returns error on rate limit', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
        }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('rate_limit')
        expect(result.error.retryable).toBe(true)
      }
    })

    it('returns network error when request() fetch fails', async () => {
      // Token succeeds
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      // Transactions request fails with network error
      fetchSpy.mockRejectedValueOnce(new Error('Connection reset'))

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
        expect(result.error.message).toContain('Connection reset')
      }
    })

    it('returns network error with generic message when error is not an Error instance', async () => {
      // Token succeeds
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      // Transactions request fails with non-Error
      fetchSpy.mockRejectedValueOnce('string error')

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
        expect(result.error.message).toContain('Network request failed')
      }
    })

    it('returns error when response JSON parsing fails', async () => {
      // Token succeeds
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      // Response with invalid JSON
      fetchSpy.mockResolvedValueOnce(
        new Response('not valid json', { status: 200 }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })

    it('returns error when response fails Zod validation', async () => {
      // Token succeeds
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      // Response with wrong structure (valid JSON but invalid schema)
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid response')
      }
    })

    it('returns error when token response fails Zod validation', async () => {
      // Token response with wrong structure
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ wrong: 'token_shape' }), { status: 200 }),
      )

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid token response')
      }
    })

    it('handles non-Error thrown during token JSON parsing', async () => {
      // Create a response that throws non-Error on json()
      const badResponse = new Response('', { status: 200 })
      vi.spyOn(badResponse, 'json').mockRejectedValueOnce('string parse error')
      fetchSpy.mockResolvedValueOnce(badResponse)

      const result = await client.getTransactions(from, to)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to parse token response')
      }
    })
  })

  describe('healthCheck', () => {
    it('returns ok when token can be obtained', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'TOKEN',
            token_type: 'Bearer',
            expires_in: 32400,
          }),
          { status: 200 },
        ),
      )

      const result = await client.healthCheck()

      expect(result.isOk()).toBe(true)
    })

    it('returns error when credentials are invalid', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_client' }), {
          status: 401,
        }),
      )

      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })

    it('returns error on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'))

      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })
  })

  describe('clearTokenCache', () => {
    it('forces token refresh on next request', async () => {
      const mockTokenResponse = {
        access_token: 'TOKEN',
        token_type: 'Bearer',
        expires_in: 32400,
      }

      // First request
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      await client.healthCheck()

      // Clear cache
      client.clearTokenCache()

      // Second request should get new token
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      )
      await client.healthCheck()

      // Should have called token endpoint twice
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })
})

describe('PAYPAL_BASE_URL', () => {
  it('is the production PayPal API URL', () => {
    expect(PAYPAL_BASE_URL).toBe('https://api-m.paypal.com')
  })
})

describe('PAYPAL_SANDBOX_URL', () => {
  it('is the sandbox PayPal API URL', () => {
    expect(PAYPAL_SANDBOX_URL).toBe('https://api-m.sandbox.paypal.com')
  })
})

describe('PAYPAL_DEFAULT_PAGE_SIZE', () => {
  it('is a reasonable default', () => {
    expect(PAYPAL_DEFAULT_PAGE_SIZE).toBeGreaterThan(0)
    expect(PAYPAL_DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(500)
  })
})

describe('PAYPAL_HISTORY_YEARS', () => {
  it('is the PayPal historical data limit', () => {
    expect(PAYPAL_HISTORY_YEARS).toBe(3)
  })
})

describe('getEarliestAllowedDate', () => {
  it('returns a date 3 years before now plus 1 day buffer', () => {
    const earliest = getEarliestAllowedDate()
    const now = DateTime.utc()
    // 3 years ago + 1 day buffer
    const expected = now.minus({ years: 3 }).plus({ days: 1 }).startOf('day')

    // Allow 1 second tolerance for test execution time
    expect(earliest.toMillis()).toBeCloseTo(expected.toMillis(), -3)
  })

  it('returns a date 3 years before the provided date plus 1 day buffer', () => {
    const referenceDate = DateTime.fromISO('2026-06-15T14:30:00Z', {
      zone: 'utc',
    })
    const earliest = getEarliestAllowedDate(referenceDate)

    // Should be 2023-06-16 at start of day (3 years ago + 1 day buffer)
    expect(earliest.year).toBe(2023)
    expect(earliest.month).toBe(6)
    expect(earliest.day).toBe(16)
    expect(earliest.hour).toBe(0)
    expect(earliest.minute).toBe(0)
    expect(earliest.second).toBe(0)
  })

  it('returns start of day', () => {
    const referenceDate = DateTime.fromISO('2026-01-15T23:59:59Z', {
      zone: 'utc',
    })
    const earliest = getEarliestAllowedDate(referenceDate)

    expect(earliest.hour).toBe(0)
    expect(earliest.minute).toBe(0)
    expect(earliest.second).toBe(0)
  })
})
