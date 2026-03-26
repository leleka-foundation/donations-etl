/**
 * Tests for Wise connector.
 */
import { DateTime } from 'luxon'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import type { IWiseClient } from '../../src/wise/connector'
import { WiseConnector } from '../../src/wise/connector'
import type { WiseBalance, WiseStatementResponse } from '../../src/wise/schema'

describe('WiseConnector', () => {
  const config = {
    apiToken: 'test-token',
    profileId: 12345,
  }

  const mockEurBalance: WiseBalance = {
    id: 111,
    currency: 'EUR',
    amount: { value: 1000, currency: 'EUR' },
  }
  const mockBalances: WiseBalance[] = [
    mockEurBalance,
    { id: 222, currency: 'USD', amount: { value: 500, currency: 'USD' } },
  ]

  const createMockClient = (): IWiseClient => ({
    getBalances: vi.fn<IWiseClient['getBalances']>(),
    getStatementForBalance: vi.fn<IWiseClient['getStatementForBalance']>(),
    healthCheck: vi.fn<IWiseClient['healthCheck']>(),
  })

  const createStatementResponse = (
    transactions: WiseStatementResponse['transactions'],
    currency: string,
    accountId: number,
  ): WiseStatementResponse => ({
    accountHolder: {
      type: 'PERSONAL',
      firstName: 'Test',
      lastName: 'User',
    },
    issuer: {
      name: 'Wise Payments Limited',
    },
    bankDetails: null,
    transactions,
    endOfStatementBalance: { value: 1000, currency },
    query: {
      intervalStart: '2025-01-01T00:00:00Z',
      intervalEnd: '2025-01-31T23:59:59Z',
      currency,
      accountId,
    },
  })

  describe('source', () => {
    it('returns wise as source', () => {
      const mockClient = createMockClient()
      const connector = new WiseConnector({ config, client: mockClient })
      expect(connector.source).toBe('wise')
    })
  })

  describe('healthCheck', () => {
    it('delegates to client healthCheck', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.healthCheck).mockReturnValue(okAsync(undefined))

      const connector = new WiseConnector({ config, client: mockClient })
      const result = await connector.healthCheck()

      expect(result.isOk()).toBe(true)
      expect(mockClient.healthCheck).toHaveBeenCalled()
    })

    it('returns error from client', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.healthCheck).mockReturnValue(
        errAsync({
          type: 'auth',
          source: 'wise',
          message: 'Unauthorized',
          retryable: false,
        }),
      )

      const connector = new WiseConnector({ config, client: mockClient })
      const result = await connector.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })
  })

  describe('fetchPage', () => {
    it('fetches from all balances and combines deposit transactions', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(okAsync(mockBalances))

      // EUR balance has one deposit
      const eurResponse = createStatementResponse(
        [
          {
            type: 'CREDIT',
            date: '2025-01-15T10:30:00.000Z',
            amount: { value: 500, currency: 'EUR' },
            totalFees: { value: 0, currency: 'EUR' },
            details: {
              type: 'DEPOSIT',
              description: 'EUR donation',
              senderName: 'Jane Smith',
            },
            runningBalance: { value: 1500, currency: 'EUR' },
            referenceNumber: 'EUR-DEPOSIT-123',
          },
        ],
        'EUR',
        111,
      )

      // USD balance has one deposit
      const usdResponse = createStatementResponse(
        [
          {
            type: 'CREDIT',
            date: '2025-01-16T10:30:00.000Z',
            amount: { value: 100, currency: 'USD' },
            totalFees: { value: 0, currency: 'USD' },
            details: {
              type: 'DEPOSIT',
              description: 'USD donation',
              senderName: 'John Doe',
            },
            runningBalance: { value: 600, currency: 'USD' },
            referenceNumber: 'USD-DEPOSIT-456',
          },
        ],
        'USD',
        222,
      )

      vi.mocked(mockClient.getStatementForBalance)
        .mockReturnValueOnce(okAsync(eurResponse))
        .mockReturnValueOnce(okAsync(usdResponse))

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchPage(options)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        // Should include deposits from both balances
        expect(result.value.events).toHaveLength(2)
        expect(result.value.events[0]?.external_id).toBe('EUR-DEPOSIT-123')
        expect(result.value.events[1]?.external_id).toBe('USD-DEPOSIT-456')
        expect(result.value.hasMore).toBe(false)
      }

      // Should have fetched from both balances
      expect(mockClient.getStatementForBalance).toHaveBeenCalledTimes(2)
      expect(mockClient.getStatementForBalance).toHaveBeenCalledWith(
        111,
        options.from,
        options.to,
        undefined,
      )
      expect(mockClient.getStatementForBalance).toHaveBeenCalledWith(
        222,
        options.from,
        options.to,
        undefined,
      )
    })

    it('filters out non-deposit transactions', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(
        okAsync([mockEurBalance]),
      )

      const response = createStatementResponse(
        [
          {
            type: 'CREDIT',
            date: '2025-01-15T10:30:00.000Z',
            amount: { value: 500, currency: 'EUR' },
            totalFees: { value: 0, currency: 'EUR' },
            details: {
              type: 'DEPOSIT',
              description: 'Actual deposit',
              senderName: 'Jane Smith',
            },
            runningBalance: { value: 1500, currency: 'EUR' },
            referenceNumber: 'DEPOSIT-123',
          },
          {
            type: 'CREDIT',
            date: '2025-01-16T10:30:00.000Z',
            amount: { value: 200, currency: 'EUR' },
            totalFees: { value: 0, currency: 'EUR' },
            details: {
              type: 'TRANSFER', // Not a deposit
              description: 'Internal transfer',
            },
            runningBalance: { value: 1700, currency: 'EUR' },
            referenceNumber: 'TRANSFER-456',
          },
          {
            type: 'DEBIT', // Not a credit
            date: '2025-01-17T10:30:00.000Z',
            amount: { value: 50, currency: 'EUR' },
            totalFees: { value: 0, currency: 'EUR' },
            details: {
              type: 'DEPOSIT', // Even if marked as deposit, DEBIT should be filtered
              description: 'Some debit',
            },
            runningBalance: { value: 1650, currency: 'EUR' },
            referenceNumber: 'DEBIT-789',
          },
        ],
        'EUR',
        111,
      )

      vi.mocked(mockClient.getStatementForBalance).mockReturnValue(
        okAsync(response),
      )

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchPage(options)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        // Should only include the CREDIT + DEPOSIT transaction
        expect(result.value.events).toHaveLength(1)
        expect(result.value.events[0]?.external_id).toBe('DEPOSIT-123')
      }
    })

    it('returns empty array when no deposits exist', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(
        okAsync([mockEurBalance]),
      )

      const response = createStatementResponse([], 'EUR', 111)
      vi.mocked(mockClient.getStatementForBalance).mockReturnValue(
        okAsync(response),
      )

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchPage(options)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toHaveLength(0)
        expect(result.value.hasMore).toBe(false)
      }
    })

    it('returns error if getBalances fails', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(
        errAsync({
          type: 'auth',
          source: 'wise',
          message: 'Unauthorized',
          retryable: false,
        }),
      )

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchPage(options)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
        expect(result.error.message).toBe('Unauthorized')
      }
    })

    it('returns error if any balance statement fetch fails', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(okAsync(mockBalances))

      // First balance succeeds
      const eurResponse = createStatementResponse([], 'EUR', 111)
      vi.mocked(mockClient.getStatementForBalance)
        .mockReturnValueOnce(okAsync(eurResponse))
        // Second balance fails
        .mockReturnValueOnce(
          errAsync({
            type: 'api',
            source: 'wise',
            message: 'API error',
            retryable: true,
          }),
        )

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchPage(options)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('api')
        expect(result.error.message).toBe('API error')
      }
    })

    it('passes currency filter to getStatementForBalance', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(
        okAsync([mockEurBalance]),
      )

      const response = createStatementResponse([], 'EUR', 111)
      vi.mocked(mockClient.getStatementForBalance).mockReturnValue(
        okAsync(response),
      )

      const connector = new WiseConnector({
        config,
        client: mockClient,
        currency: 'EUR',
      })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      await connector.fetchPage(options)

      expect(mockClient.getStatementForBalance).toHaveBeenCalledWith(
        111,
        options.from,
        options.to,
        'EUR',
      )
    })

    it('ignores cursor parameter (no pagination in Wise API)', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(
        okAsync([mockEurBalance]),
      )

      const response = createStatementResponse([], 'EUR', 111)
      vi.mocked(mockClient.getStatementForBalance).mockReturnValue(
        okAsync(response),
      )

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      // Cursor should be ignored
      const result = await connector.fetchPage(options, 'some-cursor')

      expect(result.isOk()).toBe(true)
    })
  })

  describe('fetchAll', () => {
    it('returns all deposit events from all balances', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(okAsync(mockBalances))

      const eurResponse = createStatementResponse(
        [
          {
            type: 'CREDIT',
            date: '2025-01-15T10:30:00.000Z',
            amount: { value: 500, currency: 'EUR' },
            totalFees: { value: 0, currency: 'EUR' },
            details: {
              type: 'DEPOSIT',
              description: 'EUR donation',
              senderName: 'Jane Smith',
            },
            runningBalance: { value: 1500, currency: 'EUR' },
            referenceNumber: 'EUR-DEPOSIT-123',
          },
        ],
        'EUR',
        111,
      )

      const usdResponse = createStatementResponse([], 'USD', 222)

      vi.mocked(mockClient.getStatementForBalance)
        .mockReturnValueOnce(okAsync(eurResponse))
        .mockReturnValueOnce(okAsync(usdResponse))

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchAll(options)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.source).toBe('wise')
        expect(result.value[0]?.external_id).toBe('EUR-DEPOSIT-123')
      }
    })

    it('returns empty array when no balances have transactions', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(okAsync(mockBalances))

      const emptyEurResponse = createStatementResponse([], 'EUR', 111)
      const emptyUsdResponse = createStatementResponse([], 'USD', 222)

      vi.mocked(mockClient.getStatementForBalance)
        .mockReturnValueOnce(okAsync(emptyEurResponse))
        .mockReturnValueOnce(okAsync(emptyUsdResponse))

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchAll(options)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('returns error from client', async () => {
      const mockClient = createMockClient()
      vi.mocked(mockClient.getBalances).mockReturnValue(
        errAsync({
          type: 'network',
          source: 'wise',
          message: 'Connection failed',
          retryable: true,
        }),
      )

      const connector = new WiseConnector({ config, client: mockClient })
      const options = {
        from: DateTime.fromISO('2025-01-01T00:00:00Z'),
        to: DateTime.fromISO('2025-01-31T23:59:59Z'),
        runId: 'test-run-id',
      }

      const result = await connector.fetchAll(options)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })
  })
})
