/**
 * Tests for Google OIDC authentication.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthVerifier } from '../src/auth'

const mockVerifyIdToken = vi.fn<
  (options: { idToken: string; audience: string }) => Promise<{
    getPayload: () => Record<string, unknown> | undefined
  }>
>()

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2Client {
    verifyIdToken = mockVerifyIdToken
  },
}))

import pino from 'pino'

const mockLogger = pino({ level: 'silent' })

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
const ALLOWED_DOMAIN = 'example.com'

function makeRequest(authHeader?: string): Request {
  const headers = new Headers()
  if (authHeader) {
    headers.set('authorization', authHeader)
  }
  return new Request('https://mcp.example.com/mcp', { headers })
}

describe('createAuthVerifier', () => {
  let verifyAuth: ReturnType<typeof createAuthVerifier>

  beforeEach(() => {
    vi.clearAllMocks()
    verifyAuth = createAuthVerifier(CLIENT_ID, ALLOWED_DOMAIN, mockLogger)
  })

  it('rejects requests with no Authorization header', async () => {
    const result = await verifyAuth(makeRequest())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.message).toBe('Missing Authorization header')
    }
  })

  it('rejects requests with invalid Authorization format', async () => {
    const result = await verifyAuth(makeRequest('Basic abc123'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.message).toBe('Invalid Authorization header format')
    }
  })

  it('rejects requests with empty Bearer token', async () => {
    const result = await verifyAuth(makeRequest('Bearer '))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
    }
  })

  it('rejects invalid or expired tokens', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Token expired'))

    const result = await verifyAuth(makeRequest('Bearer invalid-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.message).toBe('Invalid or expired token')
    }
  })

  it('rejects tokens with no payload', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => undefined,
    })

    const result = await verifyAuth(makeRequest('Bearer valid-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.message).toBe('Token has no payload')
    }
  })

  it('rejects tokens missing email claim', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        hd: ALLOWED_DOMAIN,
      }),
    })

    const result = await verifyAuth(makeRequest('Bearer valid-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.message).toBe('Token missing email claim')
    }
  })

  it('rejects tokens from wrong domain', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@other.com',
        hd: 'other.com',
        name: 'User',
        exp: 9999999999,
      }),
    })

    const result = await verifyAuth(makeRequest('Bearer valid-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(403)
      expect(result.error.message).toBe(
        `Access restricted to @${ALLOWED_DOMAIN} accounts`,
      )
    }
  })

  it('rejects tokens with no domain (personal Gmail)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@gmail.com',
        name: 'User',
        exp: 9999999999,
      }),
    })

    const result = await verifyAuth(makeRequest('Bearer valid-token'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(403)
    }
  })

  it('accepts valid tokens from the allowed domain', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@example.com',
        hd: ALLOWED_DOMAIN,
        name: 'Test User',
        exp: 9999999999,
      }),
    })

    const result = await verifyAuth(makeRequest('Bearer valid-token'))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.email).toBe('user@example.com')
      expect(result.user.name).toBe('Test User')
      expect(result.user.domain).toBe(ALLOWED_DOMAIN)
      expect(result.authInfo.token).toBe('valid-token')
      expect(result.authInfo.clientId).toBe(CLIENT_ID)
      expect(result.authInfo.scopes).toEqual([])
      expect(result.authInfo.expiresAt).toBe(9999999999)
    }
  })

  it('handles tokens where name is undefined', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@example.com',
        hd: ALLOWED_DOMAIN,
        exp: 9999999999,
      }),
    })

    const result = await verifyAuth(makeRequest('Bearer valid-token'))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.name).toBeUndefined()
    }
  })

  it('passes audience to verifyIdToken', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@example.com',
        hd: ALLOWED_DOMAIN,
        exp: 9999999999,
      }),
    })

    await verifyAuth(makeRequest('Bearer my-token'))

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'my-token',
      audience: CLIENT_ID,
    })
  })

  it('is case-insensitive for Bearer prefix', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@example.com',
        hd: ALLOWED_DOMAIN,
        exp: 9999999999,
      }),
    })

    const result = await verifyAuth(makeRequest('bearer my-token'))

    expect(result.ok).toBe(true)
  })
})
