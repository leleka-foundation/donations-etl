/**
 * Google OIDC authentication for the MCP server.
 *
 * Validates Google ID tokens from the Authorization header and enforces
 * Google Workspace domain restriction.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import {
  type LoginTicket,
  OAuth2Client,
  type TokenPayload,
} from 'google-auth-library'
import type { Logger } from 'pino'

/**
 * Authentication error with a descriptive message.
 */
export interface AuthError {
  status: number
  message: string
}

/**
 * Validated user information extracted from a Google ID token.
 */
export interface GoogleUser {
  email: string
  name: string | undefined
  domain: string
}

/**
 * Create an auth verifier that validates Google ID tokens.
 *
 * Returns a function that extracts the Bearer token from a request,
 * verifies it with Google, and checks the `hd` claim against the
 * allowed domain.
 */
export function createAuthVerifier(
  clientId: string,
  allowedDomain: string,
  logger: Logger,
) {
  const oauthClient = new OAuth2Client(clientId)

  return async (
    request: Request,
  ): Promise<
    | { ok: true; user: GoogleUser; authInfo: AuthInfo }
    | { ok: false; error: AuthError }
  > => {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return {
        ok: false,
        error: { status: 401, message: 'Missing Authorization header' },
      }
    }

    const match = /^Bearer\s+(.+)$/i.exec(authHeader)
    if (!match?.[1]) {
      return {
        ok: false,
        error: { status: 401, message: 'Invalid Authorization header format' },
      }
    }

    const token = match[1]

    let payload: TokenPayload
    try {
      const ticketPromise: Promise<LoginTicket> = oauthClient.verifyIdToken({
        idToken: token,
        audience: clientId,
      })
      const ticket = await ticketPromise
      const p = ticket.getPayload()
      if (!p) {
        return {
          ok: false,
          error: { status: 401, message: 'Token has no payload' },
        }
      }
      payload = p
    } catch (err) {
      logger.warn({ err }, 'Token verification failed')
      return {
        ok: false,
        error: { status: 401, message: 'Invalid or expired token' },
      }
    }

    if (!payload.email) {
      return {
        ok: false,
        error: { status: 401, message: 'Token missing email claim' },
      }
    }

    const domain = payload.hd
    if (domain !== allowedDomain) {
      logger.warn(
        { email: payload.email, hd: domain, allowedDomain },
        'Domain mismatch',
      )
      return {
        ok: false,
        error: {
          status: 403,
          message: `Access restricted to @${allowedDomain} accounts`,
        },
      }
    }

    const user: GoogleUser = {
      email: payload.email,
      name: payload.name,
      domain,
    }

    const authInfo: AuthInfo = {
      token,
      clientId,
      scopes: [],
      expiresAt: payload.exp,
      extra: { email: user.email, name: user.name, domain: user.domain },
    }

    return { ok: true, user, authInfo }
  }
}
