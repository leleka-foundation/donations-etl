# Deployment Checklist for MCP Servers

This is platform-agnostic advice for deploying an HTTP MCP server. The traps apply whether you're on Cloud Run, Lambda, Fly, Render, Railway, Kubernetes, or a VM.

## Pre-deploy checklist

- [ ] Server binds to `0.0.0.0`, not `localhost` or `127.0.0.1`. Most container platforms require this.
- [ ] Server reads its port from `$PORT` (common convention). Hardcoded ports break when the platform assigns one.
- [ ] Health check endpoint at `/health` (or `/_healthz`, whatever your platform expects) does not require auth and returns 200.
- [ ] Graceful shutdown on `SIGTERM` — close connections, flush logs, exit cleanly. Some platforms send SIGTERM with only a few seconds' grace before SIGKILL.
- [ ] `trust proxy` is set if anything in front of your server rewrites `X-Forwarded-For`. This is nearly always the case on managed platforms (Cloud Run, Render, Fly, Vercel, CloudFront). `app.set('trust proxy', 1)` for Express.
- [ ] `BASE_URL` environment variable points to the server's public HTTPS URL. If auth is enabled, the SDK uses this to build the OAuth metadata endpoints — getting it wrong means clients discover the wrong URLs and the OAuth flow breaks.
- [ ] Secrets are loaded from a secret manager, not baked into the image.
- [ ] The runtime has outbound network access to: your storage backend, your upstream IdP (if any), and any APIs the tools call.

## Handling the `BASE_URL` chicken-and-egg

Some platforms assign the public URL after deployment. Cloud Run is the prime example — you can't know the URL until the service exists, but the app needs the URL at startup to build OAuth metadata.

Solution: two-phase deploy.

```bash
# Phase 1: deploy with a placeholder BASE_URL
gcloud run deploy mcp-server --set-env-vars BASE_URL=https://placeholder.example.com ...

# Read back the actual URL
SERVICE_URL=$(gcloud run services describe mcp-server --format='value(status.url)')

# Phase 2: update BASE_URL to the real value
gcloud run services update mcp-server --update-env-vars BASE_URL=$SERVICE_URL
```

This triggers a rolling restart but it's fast and safe. Alternatively, use a custom domain that you know in advance.

## Trust proxy — the first thing that will bite you

`express-rate-limit` (and other middleware that cares about client IP) throws at startup when `X-Forwarded-For` is present but `trust proxy` is unset. The SDK's `mcpAuthRouter` enables rate limiting by default, so you'll hit this on the very first request through a load balancer.

```typescript
const app = express()
app.set('trust proxy', 1) // Trust one hop — the platform's own proxy.
```

Use `1` unless you're running your own reverse proxy in front of the platform proxy, in which case increase it.

## Global error handler

Install an Express error handler AFTER all other routes. The SDK's internal handlers catch most errors, but anything in your tool code that slips through a catch block becomes a generic 500 with no log. Catch everything and log it:

```typescript
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
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: 'server_error', error_description: err.message })
    }
  },
)
```

Without this, Express's default handler returns an HTML error page, which confuses MCP clients that expect JSON.

## Structured logging

Use a logger that outputs JSON in production so platform log aggregators can parse it. `pino` in production mode does this out of the box.

```typescript
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // In dev, pretty-print. In prod, output JSON (the default).
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty' },
  }),
})
```

Avoid `console.log` in production — it's unstructured and doesn't integrate with log levels.

## Runtime permissions

The server needs permission to:

1. **Read/write its OAuth storage.** E.g., Firestore needs `roles/datastore.user`, DynamoDB needs a matching IAM policy, Postgres needs a database user with the right grants.
2. **Reach whatever APIs your tools call.** If the tools query BigQuery, the runtime service account needs BigQuery data viewer. If they call an internal API, the runtime needs network egress and credentials.
3. **Read secrets from the secret manager.** On GCP, `roles/secretmanager.secretAccessor` on the specific secrets.

Granting these in the deploy script (as IAM bindings) is better than doing it manually — the deploy becomes repeatable.

## Upstream IdP configuration (OAuth proxy only)

If you're using Shape C, the upstream IdP (Google, GitHub, Auth0, etc.) needs to know about your server's callback URL. For most providers this is manual, done once per environment, in their web console:

- **Google:** GCP Console → APIs & Services → Credentials → your OAuth Client ID → Authorized redirect URIs → add `$BASE_URL/oauth/google/callback` (or whatever path you chose). There's no public API for this; it's console-only.
- **GitHub:** OAuth Apps → your app → Authorization callback URL. One URL per app; create separate OAuth apps for dev/staging/prod.
- **Auth0 / Okta / similar:** their dashboards all have an "allowed callback URLs" field. Some support comma-separated lists so you can share a client across environments.

Document this step in your deploy script comments and in a runbook. It's a manual step that's easy to forget when spinning up a new environment and it will break auth in a confusing way.

## Scaling considerations

- **Cold starts on serverless** (Lambda, Cloud Run, Vercel) interact badly with in-memory storage. A mid-flow OAuth session that lands on a cold instance fails because the pending authorization isn't there. Use a persistent backend.
- **Multiple instances behind a load balancer** also need persistent storage for the same reason. Every OAuth flow involves at least two requests that might hit different instances (`/authorize` and the upstream callback).
- **Session affinity is not sufficient** — the upstream callback is a browser redirect, so it may not preserve cookies/affinity from the original `/authorize` request.

## Smoke-test the deploy

After every deploy, at minimum:

```bash
# Health
curl -sf https://$HOST/health

# OAuth metadata (if Shape C)
curl -sf https://$HOST/.well-known/oauth-authorization-server | jq .
curl -sf https://$HOST/.well-known/oauth-protected-resource | jq .

# Unauthenticated /mcp returns 401 with WWW-Authenticate header
curl -si -X POST https://$HOST/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  | grep -i 'www-authenticate'
```

If any of these fail, something is wrong and a real client won't work either. If all pass but Claude.ai/Claude Code still can't connect, the problem is usually in the full OAuth flow — inject a test token into storage (see `references/oauth-proxy.md`) and call `/mcp` directly to isolate whether it's an OAuth bug or a tool-level bug.
