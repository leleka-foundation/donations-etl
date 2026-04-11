# OAuth Proxy Pattern for MCP Servers

This is the most common auth pattern for a public MCP server that needs to work with Claude.ai, Claude Code, ChatGPT, and any other MCP client. Read this whole document before writing code — the pieces all depend on each other.

## The problem

The MCP spec uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591). Every MCP client expects to be able to register itself with the authorization server at connect time by POSTing to `/register`. This is how `Claude.ai` can connect to any MCP server without the server operator having to pre-configure anything about it.

**Most upstream identity providers do not support DCR.** Google, GitHub, Auth0, Okta — none of them let a random client register itself. They require a developer to create an OAuth client manually in a console and configure fixed redirect URIs.

The proxy pattern resolves this mismatch: your MCP server acts as its own OAuth 2.1 Authorization Server (DCR-compliant) from the client's perspective, and as a standard OAuth 2.0 client to the upstream IdP. Your server is the only thing talking to the upstream IdP, so it only needs one redirect URI there — itself.

## What the SDK gives you

The `@modelcontextprotocol/sdk` TypeScript package (v1.29+ at time of writing — verify the current version) provides:

- **`mcpAuthRouter`** — an Express middleware that mounts `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/oauth-authorization-server`, and `/.well-known/oauth-protected-resource`. It handles all the OAuth 2.1 + RFC 9728 boilerplate. You provide an `OAuthServerProvider` implementation.
- **`OAuthServerProvider`** — an interface you implement. The SDK calls your methods at the right points in the flow.
- **`requireBearerAuth`** — Express middleware that validates Bearer tokens on MCP requests by calling your provider's `verifyAccessToken`.

These are Express-specific. If you're not using Express, you'll have to replicate the behavior yourself.

The SDK's example of this pattern lives at `github.com/modelcontextprotocol/example-remote-server`. It uses a mock upstream IdP — your job is to replace that with your real upstream.

## The flow

When a user connects Claude.ai (or any MCP client) to your server, this sequence runs:

1. **Client fetches metadata.** GET `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. The SDK's `mcpAuthRouter` serves these.
2. **Client registers itself.** POST `/register` with its redirect URI. Your `clientsStore.registerClient()` generates a client ID and saves it.
3. **Client sends user to `/authorize`** with PKCE challenge and its redirect URI. Your provider's `authorize()` method runs:
   - Generate a new MCP authorization code
   - Save a "pending authorization" record keyed by that code, containing the client ID, client redirect URI, and PKCE challenge
   - Redirect the user to the upstream IdP's authorize endpoint, passing `state=<mcp authorization code>` so we can correlate the callback
4. **User logs in with the upstream IdP** (Google, GitHub, etc.) and grants consent.
5. **Upstream IdP redirects to your server's callback** — e.g., `/oauth/upstream/callback?code=<upstream code>&state=<mcp authorization code>`. You implement this handler yourself (it's not part of `mcpAuthRouter`):
   - Exchange the upstream code for tokens with the upstream IdP
   - Verify the user (read email, domain, groups, whatever your policy requires)
   - Load the pending authorization by the `state` you passed through
   - Create an "installation" record: generate an MCP access token and refresh token, link them to the user and the client
   - Save a "token exchange" record keyed by the MCP authorization code, pointing at the new access token
   - **Do NOT delete the pending authorization yet.** The SDK's `/token` handler calls `challengeForAuthorizationCode()` after you return, which reads the PKCE challenge from the pending record.
   - Redirect the user back to the MCP client's redirect URI with `code=<mcp authorization code>&state=<whatever state the client originally sent>`
6. **Client POSTs to `/token`** with the MCP authorization code + PKCE verifier. The SDK's `/token` handler:
   - Calls `provider.challengeForAuthorizationCode()` to get the stored PKCE challenge and verify it
   - Calls `provider.exchangeAuthorizationCode()` to issue tokens. Your implementation looks up the token exchange record, marks it used (replay protection), reads the installation, and returns the access and refresh tokens.
7. **Client calls `/mcp`** with `Authorization: Bearer <mcp access token>`. The `requireBearerAuth` middleware calls `provider.verifyAccessToken()` with the token. You look up the installation and return an `AuthInfo` object.
8. **Later, client refreshes the token.** `/token` with `grant_type=refresh_token` calls `provider.exchangeRefreshToken()`. You rotate the tokens, save new records, delete the old ones.

## Minimum implementation

```typescript
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Response } from 'express'
import crypto from 'node:crypto'

export class MyOAuthProvider implements OAuthServerProvider {
  constructor(
    private storage: OAuthStorage, // See references/storage.md
    private upstream: UpstreamIdP, // Your IdP adapter
    private baseUrl: string, // Your server's public URL
    private logger: Logger,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (id) => this.storage.getClient(id),
      registerClient: async (client) => {
        const full = {
          ...client,
          client_id: crypto.randomBytes(32).toString('hex'),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        }
        try {
          await this.storage.saveClient(full)
        } catch (err) {
          // The SDK's /register handler swallows errors. Log explicitly
          // or you will debug blind. See references/pitfalls.md.
          this.logger.error({ err, client }, 'registerClient failed')
          throw err
        }
        return full
      },
    }
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const mcpAuthCode = crypto.randomBytes(32).toString('hex')
    await this.storage.savePendingAuth(mcpAuthCode, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      createdAt: Date.now(),
    })
    const upstreamUrl = this.upstream.buildAuthorizeUrl({
      redirectUri: `${this.baseUrl}/oauth/upstream/callback`,
      state: mcpAuthCode,
    })
    res.redirect(upstreamUrl)
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    try {
      const pending = await this.storage.getPendingAuth(code)
      if (!pending) {
        throw new InvalidGrantError('Unknown authorization code')
      }
      return pending.codeChallenge
    } catch (err) {
      this.logger.error({ err }, 'challengeForAuthorizationCode failed')
      throw err
    }
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    code: string,
  ): Promise<OAuthTokens> {
    try {
      // Replay protection: atomically mark the code used.
      const wasUnused = await this.storage.markTokenExchangeUsed(code)
      if (!wasUnused) {
        throw new InvalidGrantError(
          'Authorization code already used or invalid',
        )
      }
      const exchange = await this.storage.getTokenExchange(code)
      if (!exchange) throw new InvalidGrantError('Token exchange not found')
      const installation = await this.storage.getInstallation(
        exchange.accessToken,
      )
      if (!installation) throw new InvalidGrantError('Installation not found')
      return {
        access_token: installation.accessToken,
        refresh_token: installation.refreshToken,
        token_type: 'bearer',
        expires_in: 3600,
      }
    } catch (err) {
      this.logger.error({ err }, 'exchangeAuthorizationCode failed')
      throw err
    }
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const oldAccess = await this.storage.getAccessTokenForRefresh(refreshToken)
    if (!oldAccess) throw new InvalidGrantError('Invalid refresh token')
    const old = await this.storage.getInstallation(oldAccess)
    if (!old) throw new InvalidGrantError('Installation not found')

    const newAccess = crypto.randomBytes(32).toString('hex')
    const newRefresh = crypto.randomBytes(32).toString('hex')
    const now = Math.floor(Date.now() / 1000)
    const fresh = {
      ...old,
      accessToken: newAccess,
      refreshToken: newRefresh,
      issuedAt: now,
      expiresAt: now + 3600,
    }

    await this.storage.saveInstallation(fresh)
    await this.storage.saveRefreshMapping(newRefresh, newAccess)
    await this.storage.deleteInstallation(oldAccess)
    await this.storage.deleteRefreshMapping(refreshToken)

    return {
      access_token: newAccess,
      refresh_token: newRefresh,
      token_type: 'bearer',
      expires_in: 3600,
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const installation = await this.storage.getInstallation(token)
    // MUST throw InvalidTokenError, not a plain Error. The SDK's
    // requireBearerAuth middleware only returns 401 for SDK error types;
    // anything else becomes a 500.
    if (!installation) {
      throw new InvalidTokenError('Invalid or expired access token')
    }
    return {
      token,
      clientId: installation.clientId,
      scopes: [],
      expiresAt: installation.expiresAt,
      extra: {
        userId: installation.userId,
        email: installation.userEmail,
      },
    }
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    if (request.token_type_hint === 'refresh_token') {
      const access = await this.storage.getAccessTokenForRefresh(request.token)
      if (access) await this.storage.deleteInstallation(access)
      await this.storage.deleteRefreshMapping(request.token)
    } else {
      await this.storage.deleteInstallation(request.token)
    }
  }

  /**
   * Upstream IdP callback handler. This is NOT part of OAuthServerProvider —
   * it's a route you register on the Express app separately. The SDK's
   * mcpAuthRouter doesn't know about the upstream IdP.
   */
  async handleUpstreamCallback(
    upstreamCode: string,
    mcpAuthCode: string,
  ): Promise<{ redirectUrl: string }> {
    // Exchange the upstream code for tokens and verify the user.
    const userInfo = await this.upstream.exchangeCode(upstreamCode, {
      redirectUri: `${this.baseUrl}/oauth/upstream/callback`,
    })

    // Enforce your access policy here. Examples:
    // - Check email domain for Google Workspace restriction
    // - Check group membership for GitHub org
    // - Check role claim for Auth0
    if (!this.upstream.isAllowed(userInfo)) {
      throw new Error(`User ${userInfo.email} is not authorized`)
    }

    const pending = await this.storage.getPendingAuth(mcpAuthCode)
    if (!pending) throw new Error('Authorization session expired')

    // Create MCP tokens and save everything.
    const accessToken = crypto.randomBytes(32).toString('hex')
    const refreshToken = crypto.randomBytes(32).toString('hex')
    const now = Math.floor(Date.now() / 1000)
    const installation = {
      accessToken,
      refreshToken,
      clientId: pending.clientId,
      userId: userInfo.id,
      userEmail: userInfo.email,
      issuedAt: now,
      expiresAt: now + 3600,
    }

    await this.storage.saveInstallation(installation)
    await this.storage.saveRefreshMapping(refreshToken, accessToken)
    await this.storage.saveTokenExchange(mcpAuthCode, accessToken)

    // IMPORTANT: Do NOT delete the pending auth here. The SDK's /token
    // handler will call challengeForAuthorizationCode() after the client
    // POSTs to /token, and it needs the pending record to validate PKCE.
    // The pending record has its own TTL (e.g., 10 minutes) so it cleans
    // itself up.

    const redirectUrl = new URL(pending.redirectUri)
    redirectUrl.searchParams.set('code', mcpAuthCode)
    if (pending.state) redirectUrl.searchParams.set('state', pending.state)
    return { redirectUrl: redirectUrl.toString() }
  }
}
```

## Wiring it up in main.ts

```typescript
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'

const app = express()
app.set('trust proxy', 1) // If behind a load balancer. See deployment.md.

const provider = new MyOAuthProvider(storage, upstream, config.BASE_URL, logger)
const baseUrl = new URL(config.BASE_URL)

// Mount the SDK's OAuth endpoints: /authorize, /token, /register, etc.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: baseUrl,
    resourceServerUrl: baseUrl,
    resourceName: 'My MCP Server',
  }),
)

// Your upstream callback handler.
app.get('/oauth/upstream/callback', async (req, res) => {
  try {
    const code = req.query.code
    const state = req.query.state
    if (typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).send('Missing code or state')
      return
    }
    const { redirectUrl } = await provider.handleUpstreamCallback(code, state)
    res.redirect(redirectUrl)
  } catch (err) {
    logger.error({ err }, 'Upstream OAuth callback failed')
    res
      .status(403)
      .send(err instanceof Error ? err.message : 'Authentication failed')
  }
})

// Bearer auth middleware for the MCP endpoint.
const bearerAuth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(baseUrl),
})

app.all('/mcp', bearerAuth, express.json(), async (req, res) => {
  // ... transport handling as in SKILL.md
})

// Global error handler. The SDK's internal handlers catch and rethrow,
// but any bug outside them will 500 silently without this.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error(
      { err: { message: err.message, stack: err.stack } },
      'Unhandled error',
    )
    if (!res.headersSent)
      res
        .status(500)
        .json({ error: 'server_error', error_description: err.message })
  },
)
```

## Testing the OAuth flow locally

The full flow requires a browser to log into the upstream IdP, which is painful to script. Instead, **inject a test installation directly into your storage** and skip the upstream login for tool-level testing:

```typescript
// scripts/inject-test-token.ts
import { MyStorage } from '../src/auth/storage'
import crypto from 'node:crypto'

const storage = new MyStorage(/* ... */)
const token = 'test-' + crypto.randomBytes(32).toString('hex')
const refresh = 'test-refresh-' + crypto.randomBytes(32).toString('hex')
const now = Math.floor(Date.now() / 1000)
await storage.saveInstallation({
  accessToken: token,
  refreshToken: refresh,
  clientId: 'test-client',
  userId: 'test-user',
  userEmail: 'test@example.com',
  issuedAt: now,
  expiresAt: now + 3600,
})
console.log(token)
```

Run it, get the token, and curl `/mcp` with it. This is the fastest way to iterate on tool registration and transport bugs without sitting through the browser dance every time.

**Once the tools work with an injected token, then do the full browser flow once** to make sure the OAuth endpoints actually issue tokens correctly.

## What the SDK does NOT give you

- **The upstream IdP integration.** You write the code that talks to Google/GitHub/Auth0. The SDK knows nothing about it.
- **Storage.** Everything above goes into `OAuthStorage`, which you implement. See `references/storage.md`.
- **The upstream callback route.** You mount `/oauth/upstream/callback` on your Express app yourself.
- **Access policy.** Who's allowed in after they log in? That's your `isAllowed()` logic in the callback handler.
- **Error visibility.** The SDK's handlers catch provider errors and return generic OAuth error responses. **You must log around your provider methods** or you will debug blind. Every `try/catch/logger.error/throw` in the provider above exists for this reason.
