/**
 * Tests for check deposits connector (implements Connector interface).
 */
import { createConnectorError } from '@donations-etl/types'
import { DateTime } from 'luxon'
import { errAsync, okAsync } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CheckDepositsConnector,
  type ICheckDepositsClient,
} from '../../src/check-deposits/connector'
import type { CheckDepositRow } from '../../src/check-deposits/schema'
import type { CheckDepositsConfig, FetchOptions } from '../../src/types'

/**
 * Create a mock check deposits client for testing.
 */
function createMockClient(): ICheckDepositsClient {
  return {
    getRows: vi.fn<ICheckDepositsClient['getRows']>(),
    healthCheck: vi.fn<ICheckDepositsClient['healthCheck']>(),
  }
}

describe('CheckDepositsConnector', () => {
  const config: CheckDepositsConfig = {
    spreadsheetId: 'test-spreadsheet-id-123',
    sheetName: 'checks',
  }

  let connector: CheckDepositsConnector
  let mockClient: ICheckDepositsClient

  const mockRow: CheckDepositRow = {
    check_number: '12345',
    check_date: '9/18/2023',
    deposit_date: '9/20/2023',
    payer_name: 'Vanguard Charitable',
    donor_name: 'John Doe',
    amount: '$2,000',
    donor_email: 'john@example.com',
    donor_address: '123 Main St',
    bank_contact_info: 'Contact info',
    file_name: 'checks-2023.csv',
  }

  beforeEach(() => {
    mockClient = createMockClient()
    connector = new CheckDepositsConnector({ config, client: mockClient })
  })

  describe('source', () => {
    it('returns "check_deposits"', () => {
      expect(connector.source).toBe('check_deposits')
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
      const error = createConnectorError(
        'auth',
        'check_deposits',
        'Auth failed',
        {
          statusCode: 403,
        },
      )
      vi.mocked(mockClient.healthCheck).mockReturnValueOnce(errAsync(error))

      const result = await connector.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(403)
      }
    })
  })

  describe('fetchPage', () => {
    const fetchOptions: FetchOptions = {
      from: DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' }),
      to: DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' }),
      runId: '550e8400-e29b-41d4-a716-446655440000',
    }

    it('fetches all rows and transforms to events', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([mockRow]))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toHaveLength(1)
        const event = result.value.events[0]
        expect(event).toBeDefined()
        expect(event?.source).toBe('check_deposits')
        expect(event?.donor_name).toBe('John Doe')
        expect(event?.payer_name).toBe('Vanguard Charitable')
        expect(event?.amount_cents).toBe(200000)
        expect(event?.payment_method).toBe('check')
      }
    })

    it('always returns hasMore=false (single page)', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([mockRow]))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.hasMore).toBe(false)
        expect(result.value.nextCursor).toBeUndefined()
      }
    })

    it('ignores date range (always full reload)', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([mockRow]))

      // Date range doesn't matter - we always fetch all rows
      await connector.fetchPage({
        ...fetchOptions,
        from: DateTime.fromISO('2020-01-01T00:00:00Z', { zone: 'utc' }),
        to: DateTime.fromISO('2020-12-31T23:59:59Z', { zone: 'utc' }),
      })

      expect(mockClient.getRows).toHaveBeenCalledTimes(1)
    })

    it('ignores cursor (no pagination)', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([mockRow]))

      // Cursor is ignored
      const result = await connector.fetchPage(fetchOptions, 'some-cursor')

      expect(result.isOk()).toBe(true)
      expect(mockClient.getRows).toHaveBeenCalledTimes(1)
    })

    it('returns multiple events', async () => {
      const row2: CheckDepositRow = {
        ...mockRow,
        donor_name: 'Jane Doe',
        amount: '$5,000',
      }

      vi.mocked(mockClient.getRows).mockReturnValueOnce(
        okAsync([mockRow, row2]),
      )

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toHaveLength(2)
        expect(result.value.events[0]?.donor_name).toBe('John Doe')
        expect(result.value.events[1]?.donor_name).toBe('Jane Doe')
      }
    })

    it('returns empty events when no rows', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([]))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toEqual([])
        expect(result.value.hasMore).toBe(false)
      }
    })

    it('returns error when getRows fails', async () => {
      const error = createConnectorError(
        'network',
        'check_deposits',
        'Network error',
      )
      vi.mocked(mockClient.getRows).mockReturnValueOnce(errAsync(error))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('Network error')
      }
    })

    it('passes runId to transformer', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([mockRow]))

      const result = await connector.fetchPage(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events[0]?.run_id).toBe(fetchOptions.runId)
      }
    })
  })

  describe('fetchAll', () => {
    const fetchOptions: FetchOptions = {
      from: DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' }),
      to: DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' }),
      runId: '550e8400-e29b-41d4-a716-446655440000',
    }

    it('fetches all events (same as fetchPage for check deposits)', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([mockRow]))

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.source).toBe('check_deposits')
      }
    })

    it('returns empty array when no rows', async () => {
      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync([]))

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual([])
      }
    })

    it('returns error when client fails', async () => {
      const error = createConnectorError(
        'auth',
        'check_deposits',
        'Permission denied',
        { statusCode: 403 },
      )
      vi.mocked(mockClient.getRows).mockReturnValueOnce(errAsync(error))

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.statusCode).toBe(403)
      }
    })

    it('fetches multiple rows', async () => {
      const rows = [
        mockRow,
        { ...mockRow, donor_name: 'Jane Doe', amount: '$3,000' },
        { ...mockRow, donor_name: 'Bob Smith', amount: '$1,500' },
      ]

      vi.mocked(mockClient.getRows).mockReturnValueOnce(okAsync(rows))

      const result = await connector.fetchAll(fetchOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(3)
      }
    })
  })

  describe('constructor', () => {
    it('creates default client when not provided', () => {
      // This will create a real client (which won't work without auth),
      // but we're just verifying the constructor doesn't throw
      const connectorWithDefaultClient = new CheckDepositsConnector({
        config: {
          spreadsheetId: 'test-id',
          sheetName: 'test-sheet',
        },
      })

      expect(connectorWithDefaultClient).toBeDefined()
      expect(connectorWithDefaultClient.source).toBe('check_deposits')
    })
  })
})
