# Simple Bearer Token Authentication

Use this when you control the clients and don't need the full OAuth proxy pattern. Works well for internal services, CI scripts, or a personal MCP server where you give yourself a long-lived token.

## The pattern

Generate a shared secret. Validate it on each request with a constant-time comparison. Return proper SDK error types so `requireBearerAuth` returns 401 instead of 500.

```typescript
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import crypto from 'node:crypto'

function tokensEqual(a: string, b: string): boolean {
  // constant-time to avoid timing attacks
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    if (!tokensEqual(token, process.env.MCP_API_KEY!)) {
      throw new InvalidTokenError('Invalid token')
    }
    return {
      token,
      clientId: 'static-client',
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }
  },
}

app.all('/mcp', requireBearerAuth({ verifier }), express.json() /* ... */)
```

## What you give up

- No DCR. Clients like Claude.ai can't register themselves — you'd have to paste the token into their config (if the client even supports that for custom HTTP MCPs, which most don't).
- No per-user identity. Everyone who has the token is indistinguishable.
- No metadata discovery (`/.well-known/oauth-*`). If you want clients to discover your auth server, use the full proxy pattern.

For most Claude Code personal setups, this is fine. For anything with multiple users or anything that needs to work with Claude.ai, use `references/oauth-proxy.md` instead.

## Validating a JWT instead of a shared secret

If your identity provider issues JWTs directly (e.g., Auth0 with machine-to-machine tokens, AWS Cognito, or Firebase Auth for service accounts), you can validate them in the same pattern — just replace the `tokensEqual` comparison with JWT signature verification against the provider's JWKS endpoint.

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'

const JWKS = createRemoteJWKSet(
  new URL('https://your-idp.example.com/.well-known/jwks.json'),
)

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: 'https://your-idp.example.com/',
        audience: 'your-mcp-server',
      })
      return {
        token,
        clientId:
          typeof payload.client_id === 'string' ? payload.client_id : 'unknown',
        scopes:
          typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        expiresAt: payload.exp,
        extra: { sub: payload.sub, email: payload.email },
      }
    } catch {
      throw new InvalidTokenError('Invalid or expired token')
    }
  },
}
```

This still doesn't give you DCR, but at least you get per-user identity and don't have to manage a shared secret.
