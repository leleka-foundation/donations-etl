/**
 * Tests for check deposits schema validation.
 */
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  CheckDepositRowSchema,
  CheckDepositsConfigSchema,
} from '../../src/check-deposits/schema'

describe('CheckDepositRowSchema', () => {
  const validRow = {
    check_number: '12345',
    check_date: '9/18/2023',
    deposit_date: '9/20/2023',
    payer_name: 'Vanguard Charitable',
    donor_name: 'John Doe',
    amount: '$2,000',
    donor_email: 'john@example.com',
    donor_address: '123 Main St, City, ST 12345',
    bank_contact_info: 'Contact info here',
    file_name: 'checks-2023.csv',
  }

  describe('required fields', () => {
    it('parses a complete valid row', () => {
      const result = CheckDepositRowSchema.parse(validRow)

      expect(result.check_number).toBe('12345')
      expect(result.check_date).toBe('9/18/2023')
      expect(result.deposit_date).toBe('9/20/2023')
      expect(result.payer_name).toBe('Vanguard Charitable')
      expect(result.donor_name).toBe('John Doe')
      expect(result.amount).toBe('$2,000')
      expect(result.donor_email).toBe('john@example.com')
      expect(result.donor_address).toBe('123 Main St, City, ST 12345')
      expect(result.bank_contact_info).toBe('Contact info here')
      expect(result.file_name).toBe('checks-2023.csv')
    })

    it('requires check_number', () => {
      const row = { ...validRow, check_number: '' }

      expect(() => CheckDepositRowSchema.parse(row)).toThrow(ZodError)
    })

    it('requires check_date', () => {
      const row = { ...validRow, check_date: '' }

      expect(() => CheckDepositRowSchema.parse(row)).toThrow(ZodError)
    })

    it('requires deposit_date', () => {
      const row = { ...validRow, deposit_date: '' }

      expect(() => CheckDepositRowSchema.parse(row)).toThrow(ZodError)
    })

    it('requires payer_name', () => {
      const row = { ...validRow, payer_name: '' }

      expect(() => CheckDepositRowSchema.parse(row)).toThrow(ZodError)
    })

    it('requires donor_name', () => {
      const row = { ...validRow, donor_name: '' }

      expect(() => CheckDepositRowSchema.parse(row)).toThrow(ZodError)
    })

    it('requires amount', () => {
      const row = { ...validRow, amount: '' }

      expect(() => CheckDepositRowSchema.parse(row)).toThrow(ZodError)
    })

    it('rejects undefined check_date', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { check_date: _unused, ...rest } = validRow

      expect(() => CheckDepositRowSchema.parse(rest)).toThrow(ZodError)
    })

    it('rejects undefined deposit_date', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deposit_date: _unused, ...rest } = validRow

      expect(() => CheckDepositRowSchema.parse(rest)).toThrow(ZodError)
    })
  })

  describe('optional fields with defaults', () => {
    it('defaults donor_email to empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { donor_email: _unused, ...row } = validRow

      const result = CheckDepositRowSchema.parse(row)

      expect(result.donor_email).toBe('')
    })

    it('defaults donor_address to empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { donor_address: _unused, ...row } = validRow

      const result = CheckDepositRowSchema.parse(row)

      expect(result.donor_address).toBe('')
    })

    it('defaults bank_contact_info to empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { bank_contact_info: _unused, ...row } = validRow

      const result = CheckDepositRowSchema.parse(row)

      expect(result.bank_contact_info).toBe('')
    })

    it('defaults file_name to empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { file_name: _unused, ...row } = validRow

      const result = CheckDepositRowSchema.parse(row)

      expect(result.file_name).toBe('')
    })

    it('parses row with only required fields', () => {
      const minimalRow = {
        check_number: '99999',
        check_date: '1/1/2024',
        deposit_date: '1/2/2024',
        payer_name: 'Donor Fund',
        donor_name: 'Jane Doe',
        amount: '$500',
      }

      const result = CheckDepositRowSchema.parse(minimalRow)

      expect(result.check_number).toBe('99999')
      expect(result.check_date).toBe('1/1/2024')
      expect(result.donor_email).toBe('')
      expect(result.donor_address).toBe('')
      expect(result.bank_contact_info).toBe('')
      expect(result.file_name).toBe('')
    })
  })

  describe('edge cases', () => {
    it('accepts large dollar amounts', () => {
      const row = { ...validRow, amount: '$1,000,000' }

      const result = CheckDepositRowSchema.parse(row)

      expect(result.amount).toBe('$1,000,000')
    })

    it('accepts various date formats as strings', () => {
      const row = {
        ...validRow,
        check_date: '11/5/2023',
        deposit_date: '12/15/2023',
      }

      const result = CheckDepositRowSchema.parse(row)

      expect(result.check_date).toBe('11/5/2023')
      expect(result.deposit_date).toBe('12/15/2023')
    })

    it('accepts amount without dollar sign', () => {
      const row = { ...validRow, amount: '2000' }

      const result = CheckDepositRowSchema.parse(row)

      expect(result.amount).toBe('2000')
    })
  })
})

describe('CheckDepositsConfigSchema', () => {
  it('parses valid config with spreadsheetId', () => {
    const config = {
      spreadsheetId: 'test-spreadsheet-id-123',
    }

    const result = CheckDepositsConfigSchema.parse(config)

    expect(result.spreadsheetId).toBe('test-spreadsheet-id-123')
    expect(result.sheetName).toBe('checks') // default
  })

  it('accepts custom sheetName', () => {
    const config = {
      spreadsheetId: 'abc123',
      sheetName: 'custom-sheet',
    }

    const result = CheckDepositsConfigSchema.parse(config)

    expect(result.sheetName).toBe('custom-sheet')
  })

  it('requires spreadsheetId', () => {
    const config = { sheetName: 'checks' }

    expect(() => CheckDepositsConfigSchema.parse(config)).toThrow(ZodError)
  })

  it('rejects empty spreadsheetId', () => {
    const config = { spreadsheetId: '' }

    expect(() => CheckDepositsConfigSchema.parse(config)).toThrow(ZodError)
  })
})
