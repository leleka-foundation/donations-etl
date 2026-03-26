/**
 * Tests for Mercury connector (implements Connector interface).
 */
import { createConnectorError } from '@donations-etl/types'
import { DateTime } from 'luxon'
import { errAsync, okAsync } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MercuryConnector,
  type IMercuryClient,
} from '../../src/mercury/connector'
import type {
  MercuryAccountsResponse,
  MercuryTransactionsResponse,
} from '../../src/mercury/schema'
import type { FetchOptions, MercuryConfig } from '../../src/types'

/**
 * Create a mock Mercury client for testing.
 */
function createMockClient(): IMercuryClient {
  return {
    getAccounts: vi.fn<IMercuryClient['getAccounts']>(),
    getTransactions: vi.fn<IMercuryClient['getTransactions']>(),
    healthCheck: vi.fn<IMercuryClient['healthCheck']>(),
  }
}

describe('MercuryConnector', () => {
  const config: MercuryConfig = {
    apiKey: 'test_key',
    baseUrl: 'https://api.mercury.com',
  }

  let connector: MercuryConnector
  let mockClient: IMercuryClient

  const mockAccount = {
    id: 'acc_1',
    name: 'Main', // Must be an allowed account name
    status: 'active',
    type: 'checking',
  }

  const mockTransaction = {
    id: 'tx_1',
    amount: 1000.5,
    bankDescription: 'Wire from client',
    counterpartyId: 'cp_1',
    counterpartyName: 'Client A',
    createdAt: '2024-01-15T10:00:00Z',
    status: 'sent' as const,
    kind: 'domesticWire',
    details: null,
    note: null,
    externalMemo: null,
    failedAt: null,
    postedAt: null,
    reasonForFailure: null,
    trackingNumber: null,
    counterpartyNickname: null,
    dashboardLink: undefined,
  }

  beforeEach(() => {
    mockClient = createMockClient()
    connector = new MercuryConnector({ config, client: mockClient })
  })

  describe('source', () => {
    it('returns "mercury"', () => {
      expect(connector.source).toBe('mercury')
    })
  })

  describe('healthCheck', () => {
    it('delegates to client healthCheck', async () => {
      vi.mocked(mockClient.healthCheck).mockReturnValueOnce(okAsync(undefined))

      const result = await connector.healthCheck()

      expect(result.isOk()).toBe(true)
      expect(mockClient.healthCheck).toHaveBeenCalledTimes(1)
    })

    it('returns error from client', async () => {
      const error = createConnectorError('auth', 'mercury', 'Auth failed', {
        statusCode: 401,
      })
      vi.mocked(mockClient.healthCheck).mockReturnValueOnce(errAsync(error))

      const result = await connector.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(401)
      }
    })
  })

  describe('fetchPage', () => {
    const fetchOptions: FetchOptions = {
      from: DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' }),
      to: DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' }),
      runId: '550e8400-e29b-41d4-a716-446655440000',
    }

    it('fetches first page when no cursor provided', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] } satisfies MercuryAccountsResponse),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({
          total: 1,
          transactions: [mockTransaction],
        } satisfies MercuryTransactionsResponse),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toHaveLength(1)
        const event = result.value.events[0]
        expect(event).toBeDefined()
        expect(event?.source).toBe('mercury')
        expect(event?.external_id).toBe('tx_1')
        expect(event?.amount_cents).toBe(100050)
      }
    })

    it('returns hasMore=false when all transactions fetched', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({ total: 1, transactions: [mockTransaction] }),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.hasMore).toBe(false)
        expect(result.value.nextCursor).toBeUndefined()
      }
    })

    it('returns hasMore=true with nextCursor when more pages exist', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({
          total: 250, // More than one page
          transactions: Array(100).fill(mockTransaction),
        }),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.hasMore).toBe(true)
        expect(result.value.nextCursor).toBeDefined()
      }
    })

    it('parses cursor to resume pagination', async () => {
      const cursor = JSON.stringify({ accountIndex: 0, offset: 100 })

      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({ total: 150, transactions: Array(50).fill(mockTransaction) }),
      )

      const result = await connector.fetchPage(fetchOptions, cursor)

      expect(result.isOk()).toBe(true)
      // Verify getTransactions was called with offset
      expect(mockClient.getTransactions).toHaveBeenCalledWith(
        'acc_1',
        fetchOptions.from,
        fetchOptions.to,
        expect.objectContaining({ offset: 100 }),
      )
    })

    it('handles multiple accounts in fetchAll', async () => {
      const account2 = {
        id: 'acc_2',
        name: 'On website', // Must be an allowed account name
        status: 'active',
        type: 'savings',
      }
      const tx2 = { ...mockTransaction, id: 'tx_2' }

      vi.mocked(mockClient.getAccounts).mockReturnValue(
        okAsync({ accounts: [mockAccount, account2] }),
      )
      vi.mocked(mockClient.getTransactions)
        .mockReturnValueOnce(
          okAsync({ total: 1, transactions: [mockTransaction] }),
        )
        .mockReturnValueOnce(okAsync({ total: 1, transactions: [tx2] }))

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0]?.external_id).toBe('tx_1')
        expect(result.value[1]?.external_id).toBe('tx_2')
      }
    })

    it('includes both debits and credits in staging (filtering happens at final table load)', async () => {
      const debitTx = { ...mockTransaction, id: 'tx_debit', amount: -500 }
      const creditTx = { ...mockTransaction, id: 'tx_credit', amount: 1000 }

      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({ total: 2, transactions: [debitTx, creditTx] }),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        // Both debits and credits are included in staging
        expect(result.value.events).toHaveLength(2)
        expect(result.value.events[0]?.external_id).toBe('tx_debit')
        expect(result.value.events[1]?.external_id).toBe('tx_credit')
        // isCredit flag is set for filtering during staging-to-final load
        expect(result.value.events[0]?.source_metadata).toHaveProperty(
          'isCredit',
          false,
        )
        expect(result.value.events[1]?.source_metadata).toHaveProperty(
          'isCredit',
          true,
        )
      }
    })

    it('returns error when getAccounts fails', async () => {
      const error = createConnectorError(
        'api',
        'mercury',
        'Failed to get accounts',
      )
      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(errAsync(error))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to get accounts')
      }
    })

    it('returns error when getTransactions fails', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )
      const error = createConnectorError(
        'rate_limit',
        'mercury',
        'Rate limited',
        {
          statusCode: 429,
          retryable: true,
        },
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(errAsync(error))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(429)
        expect(result.error.retryable).toBe(true)
      }
    })

    it('returns empty events when no accounts exist', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [] }),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toEqual([])
        expect(result.value.hasMore).toBe(false)
      }
    })

    it('returns empty events when pagination is exhausted (accountIndex >= accounts.length)', async () => {
      // Cursor points beyond available accounts
      const exhaustedCursor = JSON.stringify({ accountIndex: 5, offset: 0 })

      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )

      const result = await connector.fetchPage(fetchOptions, exhaustedCursor)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toEqual([])
        expect(result.value.hasMore).toBe(false)
      }
      // Should not call getTransactions when pagination is exhausted
      expect(mockClient.getTransactions).not.toHaveBeenCalled()
    })

    it('uses default cursor when cursor JSON is valid but fails Zod validation', async () => {
      // Valid JSON but wrong shape (missing required fields)
      const invalidCursor = JSON.stringify({ foo: 'bar' })

      vi.mocked(mockClient.getAccounts).mockReturnValueOnce(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({ total: 1, transactions: [mockTransaction] }),
      )

      const result = await connector.fetchPage(fetchOptions, invalidCursor)

      expect(result.isOk()).toBe(true)
      // Should start from account 0, offset 0 (default)
      expect(mockClient.getTransactions).toHaveBeenCalledWith(
        'acc_1',
        fetchOptions.from,
        fetchOptions.to,
        expect.objectContaining({ offset: 0 }),
      )
    })

    it('moves to next account when current account is exhausted', async () => {
      const account2 = {
        id: 'acc_2',
        name: 'On website', // Must be an allowed account name
        status: 'active',
        type: 'savings',
      }

      vi.mocked(mockClient.getAccounts).mockReturnValue(
        okAsync({ accounts: [mockAccount, account2] }),
      )

      // First account has 1 transaction (exhausted in first page)
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({ total: 1, transactions: [mockTransaction] }),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.hasMore).toBe(true)
        // Next cursor should point to second account
        const cursor: unknown = JSON.parse(result.value.nextCursor ?? '{}')
        expect(cursor).toHaveProperty('accountIndex', 1)
        expect(cursor).toHaveProperty('offset', 0)
      }
    })
  })

  describe('fetchAll', () => {
    const fetchOptions: FetchOptions = {
      from: DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' }),
      to: DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' }),
      runId: '550e8400-e29b-41d4-a716-446655440000',
    }

    it('fetches all transactions from all accounts', async () => {
      const tx1 = { ...mockTransaction, id: 'tx_1' }
      const tx2 = { ...mockTransaction, id: 'tx_2' }

      vi.mocked(mockClient.getAccounts).mockReturnValue(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions).mockReturnValueOnce(
        okAsync({ total: 2, transactions: [tx1, tx2] }),
      )

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(2)
      }
    })

    it('paginates through all pages', async () => {
      // 250 total transactions = 3 pages (100 + 100 + 50)
      vi.mocked(mockClient.getAccounts).mockReturnValue(
        okAsync({ accounts: [mockAccount] }),
      )
      vi.mocked(mockClient.getTransactions)
        .mockReturnValueOnce(
          okAsync({
            total: 250,
            transactions: Array(100).fill(mockTransaction),
          }),
        )
        .mockReturnValueOnce(
          okAsync({
            total: 250,
            transactions: Array(100).fill(mockTransaction),
          }),
        )
        .mockReturnValueOnce(
          okAsync({
            total: 250,
            transactions: Array(50).fill(mockTransaction),
          }),
        )

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(250)
      }
      expect(mockClient.getTransactions).toHaveBeenCalledTimes(3)
    })

    it('returns error if any page fails', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValue(
        okAsync({ accounts: [mockAccount] }),
      )
      const error = createConnectorError('api', 'mercury', 'Server error', {
        statusCode: 500,
      })
      vi.mocked(mockClient.getTransactions)
        .mockReturnValueOnce(
          okAsync({
            total: 200,
            transactions: Array(100).fill(mockTransaction),
          }),
        )
        .mockReturnValueOnce(errAsync(error))

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isErr()).toBe(true)
    })

    it('handles empty account gracefully', async () => {
      vi.mocked(mockClient.getAccounts).mockReturnValue(
        okAsync({ accounts: [] }),
      )

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual([])
      }
    })
  })
})
