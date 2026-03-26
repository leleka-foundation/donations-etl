/**
 * Tests for Venmo connector.
 */
import { DateTime } from 'luxon'
import { errAsync, okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IVenmoClient } from '../../src/venmo/client'
import { VenmoConnector, createVenmoConnector } from '../../src/venmo/connector'
import type { VenmoCsvRow } from '../../src/venmo/schema'

describe('VenmoConnector', () => {
  const mockClient: IVenmoClient = {
    readAllCsvFiles: vi.fn<IVenmoClient['readAllCsvFiles']>(),
    healthCheck: vi.fn<IVenmoClient['healthCheck']>(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const defaultOptions = {
    from: DateTime.fromISO('2025-01-01', { zone: 'utc' }),
    to: DateTime.fromISO('2025-01-31', { zone: 'utc' }),
    runId: '550e8400-e29b-41d4-a716-446655440000',
  }

  const mockRow: VenmoCsvRow = {
    'Transaction ID': '"""123"""',
    Date: '01/01/2025',
    'Time (UTC)': '01:00:00',
    Type: 'Payment',
    Status: 'Complete',
    Note: 'Test donation',
    From: 'Test Donor',
    'Donor email': 'test@test.com',
    To: 'Test Organization',
    'Amount (total)': '+ $100.00',
    'Amount (tip)': '0',
    'Amount (tax)': '0',
    'Amount (net)': '$98.00',
    'Amount (fee)': '$2.00',
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
  const mockRows: VenmoCsvRow[] = [mockRow]

  describe('source', () => {
    it('returns venmo as source', () => {
      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      expect(connector.source).toBe('venmo')
    })
  })

  describe('fetchAll', () => {
    it('reads CSV files and transforms to events', async () => {
      vi.mocked(mockClient.readAllCsvFiles).mockReturnValue(okAsync(mockRows))

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.fetchAll(defaultOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.source).toBe('venmo')
        expect(result.value[0]?.external_id).toBe('123')
        expect(result.value[0]?.donor_name).toBe('Test Donor')
        expect(result.value[0]?.amount_cents).toBe(10000)
      }
    })

    it('returns empty array when no CSV files', async () => {
      vi.mocked(mockClient.readAllCsvFiles).mockReturnValue(okAsync([]))

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.fetchAll(defaultOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('returns error when client fails', async () => {
      vi.mocked(mockClient.readAllCsvFiles).mockReturnValue(
        errAsync({
          type: 'network',
          source: 'venmo',
          message: 'Failed to read directory',
          retryable: true,
        }),
      )

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.fetchAll(defaultOptions)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })

    it('transforms multiple rows', async () => {
      const rows: VenmoCsvRow[] = [
        ...mockRows,
        {
          ...mockRow,
          'Transaction ID': '"""456"""',
          From: 'Another Donor',
          'Amount (total)': '+ $200.00',
        },
      ]
      vi.mocked(mockClient.readAllCsvFiles).mockReturnValue(okAsync(rows))

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.fetchAll(defaultOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0]?.external_id).toBe('123')
        expect(result.value[1]?.external_id).toBe('456')
      }
    })
  })

  describe('fetchPage', () => {
    it('returns all events in single page', async () => {
      vi.mocked(mockClient.readAllCsvFiles).mockReturnValue(okAsync(mockRows))

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.fetchPage(defaultOptions)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.events).toHaveLength(1)
        expect(result.value.hasMore).toBe(false)
        expect(result.value.nextCursor).toBeUndefined()
      }
    })
  })

  describe('healthCheck', () => {
    it('delegates to client healthCheck', async () => {
      vi.mocked(mockClient.healthCheck).mockReturnValue(okAsync(undefined))

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.healthCheck()

      expect(result.isOk()).toBe(true)
      expect(mockClient.healthCheck).toHaveBeenCalled()
    })

    it('returns error when healthCheck fails', async () => {
      vi.mocked(mockClient.healthCheck).mockReturnValue(
        errAsync({
          type: 'network',
          source: 'venmo',
          message: 'Cannot access directory',
          retryable: true,
        }),
      )

      const connector = new VenmoConnector(
        { csvDirPath: '/path/to/venmo' },
        mockClient,
      )
      const result = await connector.healthCheck()

      expect(result.isErr()).toBe(true)
    })
  })
})

describe('createVenmoConnector', () => {
  it('creates connector with config', () => {
    const connector = createVenmoConnector({ csvDirPath: '/path/to/venmo' })
    expect(connector).toBeInstanceOf(VenmoConnector)
    expect(connector.source).toBe('venmo')
  })

  it('creates connector with custom client', () => {
    const mockClient: IVenmoClient = {
      readAllCsvFiles: vi.fn<IVenmoClient['readAllCsvFiles']>(),
      healthCheck: vi.fn<IVenmoClient['healthCheck']>(),
    }
    const connector = createVenmoConnector(
      { csvDirPath: '/path/to/venmo' },
      mockClient,
    )
    expect(connector).toBeInstanceOf(VenmoConnector)
  })
})
