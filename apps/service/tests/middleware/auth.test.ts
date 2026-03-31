/**
 * Tests for Bearer token authentication middleware.
 */
import { describe, expect, it } from 'vitest'
import { validateBearerToken } from '../../src/middleware/auth'

describe('validateBearerToken', () => {
  const expectedKey = 'test-api-key-12345'

  it('returns true for valid Bearer token', () => {
    expect(validateBearerToken(`Bearer ${expectedKey}`, expectedKey)).toBe(true)
  })

  it('returns false for null header', () => {
    expect(validateBearerToken(null, expectedKey)).toBe(false)
  })

  it('returns false for empty header', () => {
    expect(validateBearerToken('', expectedKey)).toBe(false)
  })

  it('returns false for wrong token', () => {
    expect(validateBearerToken('Bearer wrong-token', expectedKey)).toBe(false)
  })

  it('returns false for missing Bearer prefix', () => {
    expect(validateBearerToken(expectedKey, expectedKey)).toBe(false)
  })

  it('returns false for Basic auth scheme', () => {
    expect(validateBearerToken(`Basic ${expectedKey}`, expectedKey)).toBe(false)
  })

  it('returns false for extra spaces', () => {
    expect(validateBearerToken(`Bearer  ${expectedKey}`, expectedKey)).toBe(
      false,
    )
  })
})
