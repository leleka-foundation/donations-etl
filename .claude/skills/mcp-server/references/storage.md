# Storage for OAuth State

The OAuth proxy pattern needs persistent storage for several short- and long-lived records. This reference defines the interface and shows how to implement it on common backends.

## What needs to be stored

| Record                  | Lifetime                        | Purpose                                                                                                                                                      |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client`                | ~30 days                        | Dynamic Client Registration records. Key: `client_id`.                                                                                                       |
| `pending authorization` | ~10 min                         | Correlates the OAuth state between `/authorize` and the upstream callback. Key: MCP authorization code (hash). Holds the PKCE challenge.                     |
| `token exchange`        | ~10 min                         | Maps an MCP authorization code to the access token created during the upstream callback. Key: auth code (hash). Has a `used: boolean` for replay protection. |
| `installation`          | ~7 days (matches refresh token) | The issued MCP tokens + user identity. Key: access token (hash).                                                                                             |
| `refresh mapping`       | ~7 days                         | Maps a refresh token to its current access token so refresh-token exchange can find the installation. Key: refresh token (hash).                             |

**All tokens should be hashed before being used as keys** — SHA-256 is fine. Never store raw tokens as document IDs or primary keys; if your storage is ever exfiltrated, the hashes are harder to use than the raw values.

## The interface

```typescript
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'

export interface PendingAuthorization {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state?: string
  createdAt: number
}

export interface McpInstallation {
  accessToken: string
  refreshToken: string
  clientId: string
  userId: string
  userEmail: string
  issuedAt: number
  expiresAt: number
  // Add whatever you need for your access policy: groups, roles, etc.
}

export interface OAuthStorage {
  // Clients
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>
  saveClient(client: OAuthClientInformationFull): Promise<void>

  // Pending authorizations
  getPendingAuth(code: string): Promise<PendingAuthorization | undefined>
  savePendingAuth(code: string, auth: PendingAuthorization): Promise<void>
  deletePendingAuth(code: string): Promise<void>

  // Installations
  getInstallation(accessToken: string): Promise<McpInstallation | undefined>
  saveInstallation(installation: McpInstallation): Promise<void>
  deleteInstallation(accessToken: string): Promise<void>

  // Refresh mappings
  getAccessTokenForRefresh(refreshToken: string): Promise<string | undefined>
  saveRefreshMapping(refreshToken: string, accessToken: string): Promise<void>
  deleteRefreshMapping(refreshToken: string): Promise<void>

  // Token exchange (auth code → access token) with replay protection
  getTokenExchange(
    code: string,
  ): Promise<{ accessToken: string; used: boolean } | undefined>
  saveTokenExchange(code: string, accessToken: string): Promise<void>
  /**
   * Atomically mark the exchange as used. Returns true if we were the first
   * to mark it (i.e., the code was unused); false if it was already used or
   * doesn't exist. This is the replay protection primitive.
   */
  markTokenExchangeUsed(code: string): Promise<boolean>
}
```

## Validation, not casts

When reading records back from storage, parse them with Zod schemas. Direct `as` casts are unsafe because document data is opaque to TypeScript, and stricter lint rules will (rightly) flag them. Define the schemas once and use them in every getter:

```typescript
import { z } from 'zod'

const PendingAuthSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  state: z.string().optional(),
  createdAt: z.number(),
})

const McpInstallationSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  clientId: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
})

async getPendingAuth(code: string): Promise<PendingAuthorization | undefined> {
  const raw = await this.readDoc(`pending/${hash(code)}`)
  if (!raw) return undefined
  if (raw.expiresAt < Date.now()) return undefined
  return PendingAuthSchema.parse(raw.auth)
}
```

The `OAuthClientInformationFull` type from the SDK has its own schema (`OAuthClientInformationFullSchema`) that you can use directly.

## Choosing a backend

**In-memory Map** — fine for local dev and single-process deployments where token loss on restart is acceptable. Dead simple: `new Map<string, { data: T; expiresAt: number }>()` with a setInterval to prune expired entries. Not suitable for serverless (Lambda, Cloud Run) — every new container starts with an empty Map and breaks mid-flow OAuth sessions.

**Firestore / DynamoDB / Cosmos DB** — document stores with automatic TTL are the sweet spot. You get serverless-friendly persistence, low operational overhead, and free tiers that cover small MCP servers comfortably. Use the TTL feature to auto-expire old records. Set a scalar `expiresAt` field and let the DB clean up for you.

**Redis** — good when you already run Redis. Use `EXPIRE` / `EX` on `SET`. The `markTokenExchangeUsed` replay protection becomes a `SET key value NX EX 600` + check if it returned OK. Fast and battle-tested.

**Postgres / MySQL** — use a transactional DB when you want the records to be visible alongside your application data, or when you're doing complex queries across users. TTL is manual (a cron that deletes old rows) but that's fine. `markTokenExchangeUsed` becomes `UPDATE ... SET used = true WHERE code = $1 AND used = false RETURNING code` — if it returns a row, you were the first.

## Implementing `markTokenExchangeUsed` correctly

This is the one operation that absolutely needs atomicity. If two requests with the same auth code arrive simultaneously (a bug in the client or a deliberate replay attempt), exactly one must succeed. Don't do read-then-write — that has a race condition.

### Firestore transaction

```typescript
async markTokenExchangeUsed(code: string): Promise<boolean> {
  const ref = this.db.doc(`token_exchanges/${hash(code)}`)
  return this.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const data = snap.data()
    if (!data || data.used) return false
    tx.update(ref, { used: true })
    return true
  })
}
```

### Redis

```typescript
async markTokenExchangeUsed(code: string): Promise<boolean> {
  // SET ... NX fails if the key is already set, but here we need the
  // opposite: the key must exist (the exchange was created) and must not
  // be marked used. Use a Lua script or DEL-and-check.
  const key = `token_exchange:${hash(code)}`
  const data = await this.redis.get(key)
  if (!data) return false
  const parsed = JSON.parse(data)
  if (parsed.used) return false
  parsed.used = true
  // SET with XX (key must exist) + GET (returns old value)
  const prev = await this.redis.set(key, JSON.stringify(parsed), 'XX', 'GET')
  return prev !== null && !JSON.parse(prev).used
}
```

### Postgres

```sql
UPDATE token_exchanges
SET used = true
WHERE code_hash = $1 AND used = false
RETURNING 1
```

Returns a row only if the update actually flipped a row from unused to used. Perfect for our replay protection.

## Gotcha: undefined values

Some backends (Firestore in particular) reject `undefined` in document data. When Claude.ai registers itself as a public client, it omits `client_secret`, so the resulting `OAuthClientInformationFull` has `client_secret: undefined` rather than no key at all. Enable `ignoreUndefinedProperties: true` in the Firestore client, or strip undefined values yourself before saving.

## In-memory implementation (for local dev)

```typescript
export class InMemoryOAuthStorage implements OAuthStorage {
  private clients = new Map<
    string,
    { client: OAuthClientInformationFull; expiresAt: number }
  >()
  private pending = new Map<
    string,
    { auth: PendingAuthorization; expiresAt: number }
  >()
  private installations = new Map<
    string,
    { installation: McpInstallation; expiresAt: number }
  >()
  private refresh = new Map<
    string,
    { accessToken: string; expiresAt: number }
  >()
  private exchanges = new Map<
    string,
    { accessToken: string; used: boolean; expiresAt: number }
  >()

  private now = () => Date.now()
  private hash = (s: string) =>
    crypto.createHash('sha256').update(s).digest('hex')

  async getClient(id: string) {
    const entry = this.clients.get(id)
    if (!entry || entry.expiresAt < this.now()) return undefined
    return entry.client
  }
  async saveClient(client: OAuthClientInformationFull) {
    this.clients.set(client.client_id, {
      client,
      expiresAt: this.now() + 30 * 24 * 60 * 60 * 1000,
    })
  }

  async getPendingAuth(code: string) {
    const entry = this.pending.get(this.hash(code))
    if (!entry || entry.expiresAt < this.now()) return undefined
    return entry.auth
  }
  async savePendingAuth(code: string, auth: PendingAuthorization) {
    this.pending.set(this.hash(code), {
      auth,
      expiresAt: this.now() + 10 * 60 * 1000,
    })
  }
  async deletePendingAuth(code: string) {
    this.pending.delete(this.hash(code))
  }

  async getInstallation(token: string) {
    const entry = this.installations.get(this.hash(token))
    if (!entry || entry.installation.expiresAt < this.now() / 1000)
      return undefined
    return entry.installation
  }
  async saveInstallation(installation: McpInstallation) {
    this.installations.set(this.hash(installation.accessToken), {
      installation,
      expiresAt: this.now() + 7 * 24 * 60 * 60 * 1000,
    })
  }
  async deleteInstallation(token: string) {
    this.installations.delete(this.hash(token))
  }

  async getAccessTokenForRefresh(refresh: string) {
    const entry = this.refresh.get(this.hash(refresh))
    if (!entry || entry.expiresAt < this.now()) return undefined
    return entry.accessToken
  }
  async saveRefreshMapping(refresh: string, access: string) {
    this.refresh.set(this.hash(refresh), {
      accessToken: access,
      expiresAt: this.now() + 7 * 24 * 60 * 60 * 1000,
    })
  }
  async deleteRefreshMapping(refresh: string) {
    this.refresh.delete(this.hash(refresh))
  }

  async getTokenExchange(code: string) {
    const entry = this.exchanges.get(this.hash(code))
    if (!entry || entry.expiresAt < this.now()) return undefined
    return { accessToken: entry.accessToken, used: entry.used }
  }
  async saveTokenExchange(code: string, access: string) {
    this.exchanges.set(this.hash(code), {
      accessToken: access,
      used: false,
      expiresAt: this.now() + 10 * 60 * 1000,
    })
  }
  async markTokenExchangeUsed(code: string) {
    const entry = this.exchanges.get(this.hash(code))
    if (!entry || entry.used) return false
    entry.used = true
    return true // single-threaded Node — no race
  }
}
```

Use this for local dev, then swap in a real backend for production.
