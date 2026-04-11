# MCP Server Pitfalls

Specific bugs that are easy to hit, hard to diagnose, and expensive to debug in production. Most of these come from things that are non-obvious about the MCP SDK or the OAuth 2.1 flow. Read before you debug — you'll save hours.

## The SDK silently swallows provider errors

**Symptom:** An OAuth endpoint (`/register`, `/token`, `/authorize`) returns a generic `server_error` / `Internal Server Error` with no stack trace in your logs. Your error handler isn't hit. Nothing appears in stdout.

**Cause:** The SDK's handlers for each OAuth endpoint wrap your provider calls in `try/catch` and convert any unexpected error into an `OAuthError`. The SDK's own catch blocks don't log the original error — they just build the OAuth error response and send it. Unless you log inside your provider methods, the error is gone.

**Fix:** Wrap every provider method with a try/catch that logs the error before rethrowing:

```typescript
async registerClient(client) {
  try {
    // ... actual logic
    return fullClient
  } catch (err) {
    this.logger.error({ err, client }, 'registerClient failed')
    throw err
  }
}
```

Do this for at least `getClient`, `registerClient`, `authorize`, `challengeForAuthorizationCode`, `exchangeAuthorizationCode`, `exchangeRefreshToken`, `verifyAccessToken`, and `revokeToken`. Yes, it's repetitive. It's worth it the first time you hit a 500 in production.

## Provider methods must throw SDK error types, not plain `Error`

**Symptom:** Your `/mcp` endpoint returns 500 instead of 401 for invalid tokens. Your `/token` endpoint returns 500 instead of 400 for invalid grant codes.

**Cause:** The `requireBearerAuth` middleware and the SDK's token handler have a chain of `instanceof` checks:

```typescript
if (error instanceof InvalidTokenError) { ... res.status(401) ... }
else if (error instanceof InvalidGrantError) { ... res.status(400) ... }
else { ... res.status(500) ... }
```

If your provider throws `new Error('Invalid token')`, none of the typed branches match and you fall through to the generic 500 handler — which also doesn't have a `WWW-Authenticate` header, so clients can't recover.

**Fix:** Import the SDK's error types and use them explicitly:

```typescript
import {
  InvalidTokenError,
  InvalidGrantError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'

// In verifyAccessToken:
if (!installation)
  throw new InvalidTokenError('Invalid or expired access token')

// In exchangeAuthorizationCode / exchangeRefreshToken:
if (!exchange) throw new InvalidGrantError('Token exchange not found')
if (!oldAccessToken) throw new InvalidGrantError('Invalid refresh token')
```

This is the single most impactful fix for "it mostly works but returns 500 sometimes."

## `transport.handleRequest(req, res, req.body)` — the third arg is `parsedBody`

**Symptom:** `/mcp` returns a 400 with no useful error message, or hangs, or returns an empty SSE stream.

**Cause:** The SDK's streamable HTTP transport has this signature:

```typescript
handleRequest(req, res, parsedBody?): Promise<void>
```

The third argument is the pre-parsed JSON body, not an options object. It's easy to misread the SDK docs and pass `{ authInfo: req.auth }` there — which the transport then tries to parse as a JSON-RPC message and rejects.

**Fix:** Mount `express.json()` on the `/mcp` route, then pass `req.body` as the third arg. The SDK reads `req.auth` from the request object itself (the bearer auth middleware attached it).

```typescript
app.all('/mcp', bearerAuth, express.json(), async (req, res) => {
  // ...
  await transport.handleRequest(req, res, req.body) // NOT {authInfo: ...}
})
```

## Don't delete pending authorizations in the upstream callback

**Symptom:** OAuth flow fails at the `/token` step with "Unknown authorization code" — even though you just redirected back from the upstream callback with a valid code.

**Cause:** You're deleting the pending authorization record in the upstream callback handler, but the SDK's `/token` handler calls `provider.challengeForAuthorizationCode()` after the client POSTs to `/token`, and that method reads the PKCE challenge from the pending record.

**Fix:** Don't delete pending authorizations in the callback. Let them expire via TTL instead (10 minutes is plenty).

```typescript
// In your upstream callback:
await this.storage.saveInstallation(installation)
await this.storage.saveTokenExchange(mcpAuthCode, accessToken)
// await this.storage.deletePendingAuth(mcpAuthCode)  // DO NOT do this
```

## Public clients register without a `client_secret` — storage may reject undefined

**Symptom:** `/register` returns 500 when Claude.ai or Claude Code tries to connect.

**Cause:** MCP clients are often public OAuth clients (no confidential secret) — they register with `token_endpoint_auth_method: "none"` and no `client_secret`. Your code passes `undefined` into the storage backend, which some databases reject.

**Fix, backend-specific:**

- **Firestore:** enable `ignoreUndefinedProperties: true` on the client.
- **DynamoDB:** it accepts nulls but not undefined; strip undefined values with `JSON.parse(JSON.stringify(obj))` before writing (or map them to nulls).
- **Postgres:** write the client as JSON in a `jsonb` column and undefined vanishes automatically.
- **Redis:** serialize to JSON, undefined vanishes.

## Trust proxy is required behind any load balancer

**Symptom:** `/register` (or any endpoint covered by rate limiting) returns 500 on the first request, with a stack trace about `X-Forwarded-For` or `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.

**Cause:** `express-rate-limit` (which `mcpAuthRouter` uses by default) refuses to run when it sees an `X-Forwarded-For` header but `trust proxy` is unset — it would otherwise rate-limit every request to the same IP (the load balancer's).

**Fix:** Add `app.set('trust proxy', 1)` before mounting any middleware. Use `1` for a single hop; increase if you have multiple proxies.

## The `mcpAuthRouter` is Express-only

**Symptom:** You're building on Bun with `Bun.serve()` or on Cloudflare Workers, and you can't figure out how to wire up the SDK's OAuth helpers.

**Cause:** `mcpAuthRouter` returns an `express.RequestHandler`. It expects Express's `req`/`res`/`next` conventions. It doesn't work with `fetch`-style handlers.

**Fix:** If you want OAuth, use Express (it runs fine on Bun — you don't need Node.js). If you absolutely need a `fetch`-based runtime, use `WebStandardStreamableHTTPServerTransport` and implement the OAuth endpoints yourself, or use a higher-level framework like FastMCP that handles this for you.

## Global error handler must be the LAST middleware

**Symptom:** Errors still return HTML or generic responses despite having an error handler.

**Cause:** Express error handlers (`(err, req, res, next) => {}`) only catch errors from middleware mounted before them. If you mount `app.use(errorHandler)` before the routes, it never sees their errors.

**Fix:** The error handler goes LAST, after all routes and the catch-all 404:

```typescript
app.all('/mcp', bearerAuth, express.json(), async (req, res) => {
  /* ... */
})
app.get('/oauth/upstream/callback', async (req, res) => {
  /* ... */
})
// ... all other routes ...
app.use((err, _req, res, _next) => {
  /* error handler */
}) // LAST
```

## Session-affinity vs sessionless OAuth flow

**Symptom:** Multi-instance deployments lose OAuth flows mid-way — users see "session expired" errors after clicking through the upstream IdP.

**Cause:** The OAuth flow involves at least two separate HTTP requests (`/authorize` → upstream IdP → upstream callback). If they hit different backend instances and the state is only in memory, the second request can't find the state from the first.

**Fix:** Use persistent storage for OAuth state — not in-memory maps. See `references/storage.md`. Session affinity doesn't fix this because the upstream callback arrives as a fresh browser request and may not carry affinity cookies.

## The `hd` Google Workspace parameter is a hint, not enforcement

**Symptom:** Users from outside your Google Workspace domain can complete the login and get an MCP token.

**Cause:** Passing `hd=example.com` to Google's `/authorize` URL only affects the account chooser UI — it doesn't prevent a user from picking a different account or bypassing the hint. Google's docs say this explicitly.

**Fix:** Enforce the domain restriction server-side in your upstream callback. Check the `hd` claim in the ID token (or call Google's userinfo endpoint) and reject the login if it doesn't match:

```typescript
if (payload.hd !== this.allowedDomain) {
  throw new Error(`Access restricted to @${this.allowedDomain}`)
}
```

## Training data on `@modelcontextprotocol/sdk` is out of date

**Symptom:** Code you wrote based on your training data doesn't compile or doesn't behave as expected.

**Cause:** The MCP spec and the SDK are both evolving fast. APIs that existed six months ago may be renamed, replaced, or removed. The "correct" example you remember may no longer be correct.

**Fix:** Before writing any code, read the actual files in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/` — the `.d.ts` files tell you exactly what's exported and what the current signatures are. Or search the web for the current docs. Don't trust your memory of the SDK API.

## Claude Code/Claude.ai client config format is not stable

**Symptom:** You add your MCP server to `.mcp.json` or `settings.json` or `~/.claude.json` and it doesn't show up.

**Cause:** The location and schema of MCP client config files in Claude Code has changed multiple times. Project `.mcp.json` with `type: "http"` is current as of early 2026, but the key names (`type: "url"` vs `type: "http"` vs `type: "sse"`) and file paths have been different in recent versions.

**Fix:** When things don't work, verify by checking current Claude Code documentation rather than assuming the format you remember is correct. Also check whether the specific file requires a restart of Claude Code to take effect (most do).

## Stdio transport has no OAuth

**Symptom:** You're building a `StdioServerTransport` MCP server and trying to add OAuth.

**Cause:** Stdio MCP servers are invoked as subprocesses by the client. There's no HTTP layer, no bearer tokens, no OAuth — the client has full authority over the server by definition.

**Fix:** If you need auth, use HTTP transport. If you're doing stdio, accept that there's no auth and make sure the tools the server exposes are appropriate for "anyone who can run this process has full access."
