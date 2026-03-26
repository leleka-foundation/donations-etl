/**
 * Tests for check deposits Google Sheets client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CheckDepositsClient,
  DEFAULT_SHEET_NAME,
} from '../../src/check-deposits/client'
import type { CheckDepositsConfig } from '../../src/types'

// Mock data for spreadsheet rows
type MockFn = ReturnType<typeof vi.fn<() => Promise<void>>>
type MockGetRowsFn = ReturnType<
  typeof vi.fn<() => Promise<{ get: (field: string) => string | undefined }[]>>
>
let mockLoadInfo: MockFn
let mockGetRows: MockGetRowsFn
let mockSheetsByTitle: Record<string, { getRows: MockGetRowsFn } | undefined>

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  GoogleAuth: class MockGoogleAuth {
    scopes: string[] = []
    constructor(_options: { scopes?: string[] }) {
      this.scopes = _options.scopes ?? []
    }
    getClient = vi.fn<() => Promise<unknown>>()
  },
}))

// Mock google-spreadsheet
vi.mock('google-spreadsheet', () => ({
  GoogleSpreadsheet: class MockGoogleSpreadsheet {
    spreadsheetId: string
    constructor(id: string, _auth: unknown) {
      this.spreadsheetId = id
    }
    loadInfo = async () => mockLoadInfo()
    get sheetsByTitle() {
      return mockSheetsByTitle
    }
  },
}))

describe('CheckDepositsClient', () => {
  const config: CheckDepositsConfig = {
    spreadsheetId: 'test-spreadsheet-id-123',
    sheetName: 'checks',
  }

  beforeEach(() => {
    // Reset mocks for each test
    mockLoadInfo = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockGetRows = vi
      .fn<() => Promise<{ get: (field: string) => string | undefined }[]>>()
      .mockResolvedValue([])
    mockSheetsByTitle = {
      checks: {
        getRows: mockGetRows,
      },
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('uses provided sheetName', () => {
      const client = new CheckDepositsClient({
        spreadsheetId: 'test-id',
        sheetName: 'custom-sheet',
      })

      expect(client).toBeDefined()
    })

    it('uses default sheetName when not provided', () => {
      const client = new CheckDepositsClient({
        spreadsheetId: 'test-id',
      })

      expect(client).toBeDefined()
    })
  })

  describe('getRows', () => {
    it('returns validated rows from spreadsheet', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
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
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '67890',
              check_date: '10/1/2023',
              deposit_date: '10/3/2023',
              payer_name: 'Schwab Charitable',
              donor_name: 'Jane Doe',
              amount: '$5,000',
              donor_email: '',
              donor_address: '',
              bank_contact_info: '',
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0]?.donor_name).toBe('John Doe')
        expect(result.value[0]?.check_number).toBe('12345')
        expect(result.value[1]?.donor_name).toBe('Jane Doe')
        expect(result.value[1]?.check_number).toBe('67890')
      }
    })

    it('skips rows missing payer_name', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '67890',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: '', // Empty - should be skipped
              donor_name: 'Invalid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_name).toBe('Valid Row')
      }
    })

    it('skips rows missing donor_name', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '67890',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test Payer',
              donor_name: '', // Empty - should be skipped
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_name).toBe('Valid Row')
      }
    })

    it('skips rows missing check_number', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '', // Empty - should be skipped
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test Payer',
              donor_name: 'Invalid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_name).toBe('Valid Row')
      }
    })

    it('skips rows missing amount', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '67890',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test Payer',
              donor_name: 'Invalid Row',
              amount: '', // Empty - should be skipped
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_name).toBe('Valid Row')
      }
    })

    it('skips duplicate rows (same payer_name and check_number)', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Vanguard Charitable',
              donor_name: 'First Entry',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345', // Same check_number
              check_date: '9/19/2023',
              deposit_date: '9/21/2023',
              payer_name: 'Vanguard Charitable', // Same payer_name
              donor_name: 'Duplicate Entry',
              amount: '$200',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345', // Same check_number but different payer
              check_date: '9/19/2023',
              deposit_date: '9/21/2023',
              payer_name: 'Schwab Charitable', // Different payer_name
              donor_name: 'Different Payer Entry',
              amount: '$300',
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(2)
        expect(result.value[0]?.donor_name).toBe('First Entry')
        expect(result.value[1]?.donor_name).toBe('Different Payer Entry')
      }
    })

    it('skips rows that fail Zod validation', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
        {
          get: (field: string) => {
            // Missing required fields (check_date and deposit_date empty)
            // These pass pre-validation but fail Zod
            const data: Record<string, string> = {
              check_number: '67890',
              check_date: '', // Invalid - required by Zod
              deposit_date: '', // Invalid - required by Zod
              payer_name: 'Test',
              donor_name: 'Invalid Row',
              amount: '$100',
              file_name: '',
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_name).toBe('Valid Row')
      }
    })

    it('returns error when spreadsheet load fails', async () => {
      mockLoadInfo.mockRejectedValue(new Error('Failed to load spreadsheet'))

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.source).toBe('check_deposits')
        expect(result.error.message).toContain('Failed to load spreadsheet')
      }
    })

    it('returns error when sheet not found', async () => {
      mockSheetsByTitle = {}

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('validation')
        expect(result.error.message).toContain('not found')
      }
    })

    it('returns auth error for permission issues', async () => {
      mockLoadInfo.mockRejectedValue(new Error('403 permission denied'))

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })

    it('returns auth error for 401 errors', async () => {
      mockLoadInfo.mockRejectedValue(new Error('401 Unauthorized'))

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('auth')
      }
    })

    it('returns network error for generic errors', async () => {
      mockLoadInfo.mockRejectedValue(new Error('Network timeout'))

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.type).toBe('network')
      }
    })

    it('handles non-Error thrown values', async () => {
      mockLoadInfo.mockRejectedValue('string error')

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to load spreadsheet')
      }
    })

    it('returns error when getRows fails with Error', async () => {
      mockGetRows.mockRejectedValue(new Error('Failed to get rows'))

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to get rows')
      }
    })

    it('returns error when getRows fails with non-Error', async () => {
      mockGetRows.mockRejectedValue('getRows error')

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to fetch rows')
      }
    })

    it('uses custom sheet name from config', async () => {
      const customConfig: CheckDepositsConfig = {
        spreadsheetId: 'test-id',
        sheetName: 'custom-sheet',
      }
      mockSheetsByTitle = {
        'custom-sheet': {
          getRows: mockGetRows,
        },
      }

      const client = new CheckDepositsClient(customConfig)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
    })

    it('defaults null values to empty strings', async () => {
      const mockRows = [
        {
          get: (field: string) => {
            const data: Record<string, string | undefined> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid',
              amount: '$100',
              donor_email: undefined, // Will be defaulted
              donor_address: undefined,
              bank_contact_info: undefined,
              file_name: undefined,
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_email).toBe('')
      }
    })

    it('handles row with only deposit_date (check_date null)', async () => {
      const mockRows = [
        {
          get: (field: string): string | undefined => {
            const data: Record<string, string | undefined> = {
              check_number: '12345',
              check_date: undefined, // Will use ?? fallback
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid',
              amount: '$100',
              donor_email: undefined,
              donor_address: undefined,
              bank_contact_info: undefined,
              file_name: undefined,
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      // Row fails validation because check_date is required
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('handles row with only check_date (deposit_date null)', async () => {
      const mockRows = [
        {
          get: (field: string): string | undefined => {
            const data: Record<string, string | undefined> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: undefined, // Will use ?? fallback
              payer_name: 'Test',
              donor_name: 'Valid',
              amount: '$100',
              donor_email: undefined,
              donor_address: undefined,
              bank_contact_info: undefined,
              file_name: undefined,
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      // Row fails validation because deposit_date is required
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(0)
      }
    })

    it('handles row with all null optional fields', async () => {
      const mockRows = [
        {
          get: (field: string): string | undefined => {
            const data: Record<string, string | undefined> = {
              check_number: '12345',
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: 'Test',
              donor_name: 'Valid',
              amount: '$100',
              donor_email: undefined, // All optional fields undefined
              donor_address: undefined,
              bank_contact_info: undefined,
              file_name: undefined,
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0]?.donor_email).toBe('')
        expect(result.value[0]?.donor_address).toBe('')
        expect(result.value[0]?.bank_contact_info).toBe('')
        expect(result.value[0]?.file_name).toBe('')
      }
    })

    it('covers null coalescing fallbacks for required fields', async () => {
      // This tests the ?? '' fallback branches for payer_name, donor_name, amount
      // when row.get() returns undefined. These rows will fail pre-validation
      // because required fields are missing (empty after fallback).
      const mockRows = [
        {
          get: (field: string): string | undefined => {
            const data: Record<string, string | undefined> = {
              check_number: undefined, // Tests ?? fallback
              check_date: '9/18/2023',
              deposit_date: '9/20/2023',
              payer_name: undefined, // Tests ?? fallback
              donor_name: undefined, // Tests ?? fallback
              amount: undefined, // Tests ?? fallback
              donor_email: undefined,
              donor_address: undefined,
              bank_contact_info: undefined,
              file_name: undefined,
            }
            return data[field]
          },
        },
      ]

      mockGetRows.mockResolvedValue(mockRows)

      const client = new CheckDepositsClient(config)
      const result = await client.getRows()

      // Row fails pre-validation (required fields are empty after fallback)
      // but the fallback branches are covered
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(0) // Row skipped due to missing payer_name
      }
    })
  })

  describe('healthCheck', () => {
    it('returns ok when spreadsheet is accessible', async () => {
      const client = new CheckDepositsClient(config)
      const result = await client.healthCheck()

      expect(result.isOk()).toBe(true)
    })

    it('returns error when spreadsheet access fails', async () => {
      mockLoadInfo.mockRejectedValue(new Error('Connection failed'))

      const client = new CheckDepositsClient(config)
      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
    })

    it('returns error when sheet not found', async () => {
      mockSheetsByTitle = {}

      const client = new CheckDepositsClient(config)
      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('not found')
      }
    })

    it('handles non-Error thrown values in health check', async () => {
      mockLoadInfo.mockRejectedValue('health check failed')

      const client = new CheckDepositsClient(config)
      const result = await client.healthCheck()

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to load spreadsheet')
      }
    })
  })
})

describe('DEFAULT_SHEET_NAME', () => {
  it('is "checks"', () => {
    expect(DEFAULT_SHEET_NAME).toBe('checks')
  })
})
