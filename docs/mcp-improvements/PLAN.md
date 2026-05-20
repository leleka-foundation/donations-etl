# MCP Server Improvements — Plan

Branch: `mcp/improvements-disconnects-and-compliance-distribution`

Two independent workstreams, can ship as separate PRs:

1. **Stabilize the deployed MCP server** so adding it as a Claude.ai/Cowork connector doesn't lead to frequent disconnects. **Effectively shipped 2026-05-20 — observing in production.**
2. **Expose compliance tooling to non-engineer teammates** via the same MCP server, plus a Slack-command path. **Not started.**

Acceptance gates from `.claude/rules/*` apply throughout: TDD, 100% coverage on new code, `bun typecheck`/`lint`/`test:run` all green, no `any`, no `as` (except documented JSONB), Zod on all external data.

---

## Workstream 1 — Disconnect fix

### Status

| Item                                                                 | State                                 | Where                                  |
| -------------------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| Diagnostic logging on the OAuth flow                                 | **Shipped**                           | commit `66dd3c6`, revision `00022-6mm` |
| Access-token TTL 1h → 7d                                             | **Shipped**                           | commit `b244572`, revision `00023-b7z` |
| Draft PR opened                                                      | **Open**                              | leleka-foundation/nonprofit-toolkit#18 |
| Cloud Run session affinity                                           | **Deferred** — not needed in practice | —                                      |
| `no-cpu-throttling`                                                  | **Deferred** — not needed in practice | —                                      |
| Stateless `StreamableHTTPServerTransport`                            | **Deferred** — not needed in practice | —                                      |
| Resource-metadata 404 on `/.well-known/oauth-protected-resource/mcp` | **Open, low priority**                | —                                      |

### What I originally hypothesized

The deployed Cloud Run service `mcp-server` keeps an in-memory `Map<sessionId, transport>` (`apps/mcp/src/main.ts:68`), has no Cloud Run session-affinity annotation, and CPU is throttled between requests. The initial reading of the logs interpreted repeated `MCP session started` events as the wrong-instance bug — sessions lost when Cloud Run round-robins between instances. That story was wrong for the actual symptom the user described (overnight connector "disabled").

### What we actually found, after shipping diagnostic logging

Today's logs (2026-05-20) showed:

- **The refresh flow works correctly.** A token issued the previous day refreshed cleanly: every `exchangeRefreshToken:*` log line fired in order — `start` → `refresh mapping found` → `installation found` → `success`. No 400s.
- **Claude.ai does not auto-refresh on background 401s.** Two separate 401 bursts on `/mcp` (12:14 and 14:57) saw no follow-up `/token` request. Claude.ai kept hammering `/mcp` with the expired access token, getting 401s, never attempting a refresh.
- **The refresh only happens when the user opens the Connections page.** At 16:49 the user opened Connections; claude.ai immediately sent a `/token` request; refresh succeeded; tools resumed. No re-auth, no Google sign-in, just a successful token rotation.

The earlier 400 bursts (05-14, 05-18 04:06) seen in the older logs were probably a separate, transient cause — possibly DCR client expiry on the claude.ai side, or local state churn. They have not recurred since the instrumentation went in.

### Actual root cause

**Short access-token TTL × claude.ai's 401 polling behavior.** With `TOKEN_LIFETIME_S = 3600` (1h), the access token expires every hour during normal idle. Claude.ai's background `/mcp` polls hit 401, and after enough of them claude.ai's UI flags the connector as broken — without ever attempting the refresh that would fix it. The "broken" state is only cleared by a user-initiated Connections-page visit.

This is the dominant disconnect signal. Session routing and CPU throttling may still matter in edge cases (SSE streams in particular), but they're not what was making the connector look broken overnight.

### What shipped

1. **Diagnostic logging** (commit `66dd3c6`)
   - New `tokenFingerprint(token)` helper (first 12 hex of SHA256, matches Firestore doc-id prefix for cross-reference).
   - `apps/mcp/src/auth/provider.ts`: structured logs at every decision point in `exchangeRefreshToken`, `exchangeAuthorizationCode`, `verifyAccessToken`, `revokeToken`.
   - `apps/mcp/src/auth/audit-log.ts` (new): `tokenAuditLogger` middleware mounted before `mcpAuthRouter` for `/token`. Captures the redacted request shape on entry and the response status on finish — catches errors the SDK swallows in `authenticateClient` before our provider sees them.

2. **Access-token TTL 1h → 7d** (commit `b244572`)
   - `TOKEN_LIFETIME_S = 7 * 24 * 60 * 60`.
   - Comment in the code documents the claude.ai behavior + the security tradeoff (single-tenant server, scope of leaked-token impact bounded by `MCP_ALLOWED_DOMAIN`).
   - Refresh tokens still rotate on every use; effective leak window is `min(7d, next-refresh)`.

3. **No behavior change to the transport, session map, or Cloud Run config.** The session-affinity / no-cpu-throttling / stateless-transport changes from the original plan are not needed if the 7-day TTL kills the disconnect signal in practice.

### What's still open (low priority)

- **Resource-metadata 404** on `GET /.well-known/oauth-protected-resource/mcp` — some clients probe a path-suffixed metadata URL per RFC 9728. The SDK only serves the canonical path. Investigate whether claude.ai uses the suffixed URL and whether the 404 has any user-visible effect. Probably harmless. Easy fix if needed: route the suffix to the canonical handler.

### Verification

- ✅ Unit tests for new logging + new TTL constant. `bun test:coverage` 100% on all changed files. 2447 tests pass.
- ⏳ **Production observation.** Watch the deployed mcp-server over the next 1–2 weeks. Success criterion: no spontaneous "connector disabled" reports from teammates, no daily 400-burst pattern in `/token` logs.
- 🔍 **If a disconnect does recur**, the diagnostic logging will show exactly which path failed (audit-only / `refresh mapping not found` / `installation not found` / `verifyAccessToken: token expired`). The fix then follows from the signal.

### Out of scope

- Migrating session state to Firestore. Not needed for our tool surface (no notifications, no resource subscriptions, no progress streams).
- Switching to stateless `StreamableHTTPServerTransport`. Was on the original plan as a belt-and-suspenders; deferred unless production observation shows it's needed.
- Cloud Run session affinity. Same rationale — only worth doing if production observation surfaces a residual problem.
- Changing the OAuth flow itself or rotating to Firestore-TTL'd documents.

---

## Workstream 2 — Compliance access for non-engineer teammates

**Status: not started.** This section is unchanged from the original plan.

### What I found

- Compliance code lives in `src/compliance/`. The agent entry points are `runOnboardingProduction`, `runDiscoveryProduction`, `getComplianceStatusProduction`, `recordComplianceEvidenceProduction` in `src/compliance/skills/*-wiring.ts`.
- The Claude Code skills under `.claude/skills/compliance-{onboard,discover,status}/` only run when an engineer is using Claude Code locally — they aren't visible to Claude.ai or Cowork.
- The deployed MCP server exposes `query-bigquery` and `generate-letter` only. Compliance is not reachable from Claude.ai/Cowork today.
- Slack bot (`apps/slack-bot`) already has one slash command (`/donor-letter`) wired up under `src/slack/commands/`. Adding compliance commands fits the existing pattern.
- Per the user's decisions: expose `compliance-status`, `compliance-discover`, `compliance-record-evidence` (NOT `compliance-onboard`); make them available via Claude.ai connector, Cowork connector, and a Slack command.

### Why onboarding is excluded

Onboarding requires interactive interview + writing secrets. It's a one-time setup that an admin should do via Claude Code or a CLI, not something a teammate triggers from chat. The plan keeps onboarding on the engineer-only surface.

### Approach

#### 2a. Add compliance MCP tools to `apps/mcp`

For each new tool, follow the existing `query-bigquery` / `generate-letter` pattern: a handler file under `apps/mcp/src/tools/`, registered in `main.ts`, with the same Zod-validated inputs / Result-shaped outputs that the wiring function already produces. Reuse the `*Production` functions verbatim — they already handle migration, auth to GCP, and Result-style errors.

- **`compliance-status`** — no input args (or optional `format: 'markdown' | 'json'`). Calls `getComplianceStatusProduction({ projectId: config.PROJECT_ID })`. Returns the markdown report from `formatComplianceStatusReport` plus structured findings.
- **`compliance-discover`** — no input args. Calls `runDiscoveryProduction({ projectId })`. Returns the markdown report from `formatDiscoveryReport` plus per-source outcomes. Long-running (up to ~2 min for the IRS BMF download path). The tool description must warn about runtime.
- **`compliance-record-evidence`** — inputs: `sourceId: string`, `evidence: Record<string, unknown>`, optional `observedAt: string`. Calls `recordComplianceEvidenceProduction(...)`. Validates the evidence body shape per-source on the server side.

Each tool must:

- Validate inputs with Zod (see `.claude/rules/external-data-validation.md`).
- Return `{ content: [...], isError?: true }` per MCP SDK contract.
- Surface `not_onboarded` as a clear human-readable error pointing the user back to onboarding.
- Have 100% unit-test coverage; mock the `*Production` functions, do not hit GCP.

#### 2b. Make Playwright available in the deployed image (only if needed for discover)

`compliance-discover` Phase 2/3 includes Playwright sources (CA AG, CA SOS, CDTFA, etc.). The current `apps/mcp/Dockerfile` already installs Chromium and excludes `playwright`/`playwright-core` from the bundle but does install them as deps. Verify Playwright runs in the deployed container; if not, fix paths or pin a known-good Chromium revision. Add a smoke test invoking one Playwright source from a deployed-image test.

If Playwright is unworkable in the MCP container, fall back to running discover via a separate Cloud Run Job and have the MCP tool kick it off + poll — but only if needed. Document the decision in the PR description.

#### 2c. Slack slash commands

Add `apps/slack-bot/src/slack/commands/compliance-status.ts` and `compliance-discover.ts` following the existing `donor-letter.ts` pattern. Each:

- Acknowledges the command immediately (Slack's 3s rule).
- Calls the same wiring functions.
- Posts the markdown report back into the channel/thread.
- Authorizes only authenticated workspace users (existing slack-bot middleware).

Skip `compliance-record-evidence` from Slack for now (evidence entry is multi-field; better as a guided chat in Claude.ai). Note in PR description.

#### 2d. Teammate documentation

A short README (`docs/mcp-improvements/TEAM-SETUP.md`) telling a non-engineer teammate exactly how to:

1. Open Claude.ai / Cowork.
2. Add the connector: paste the deployed MCP URL.
3. Sign in with their `@leleka.care` Google account.
4. Try `Show me our compliance status` as the first prompt.

Plus Slack: which channel(s) the bot is in, the two slash commands.

#### 2e. Update the MCP `donations-schema` prompt or add a `compliance-onboard` prompt

The existing prompt `donations-schema` only describes the donations table. Add a second MCP prompt `compliance-overview` that gives the host LLM the same orientation the engineer-side skill provides: what sources exist, how to interpret findings, how to walk a user through `Action Required` items. Keep it short; defer details to per-tool descriptions.

### Verification

- Unit tests for each new MCP tool handler (mocked production functions, full coverage).
- Integration test that the MCP server lists the three new tools and that a `tools/call` for `compliance-status` returns the expected markdown for a known stored state.
- Manual smoke test from Claude.ai: connect, run `compliance-status`, run `compliance-discover`, run `compliance-record-evidence` for one CDTFA source.
- Manual smoke test of Slack commands in a dev channel.

### Out of scope

- Exposing `compliance-onboard` to Claude.ai/Cowork.
- A multi-tenant model (current code is single-tenant per `docs/compliance/PLAN.md`).
- Building a web UI; chat is the UI.

---

## Sequencing

- **PR 1 (Workstream 1):** disconnect stabilization. **Open as draft** — leleka-foundation/nonprofit-toolkit#18. Contains diagnostic logging + 7-day token TTL. Promote out of draft once production observation confirms no recurring disconnects.
- **PR 2 (Workstream 2):** compliance tools + Slack commands + team docs. Not started.

## Open questions for the user

1. **Cowork connector mechanism.** Assuming Cowork uses the same MCP connector model as Claude.ai (paste URL, Google OAuth). If Cowork requires a different distribution channel (org-level connector approval, marketplace listing, etc.), need confirmation before writing the teammate docs.
2. ~~**Token lifetime.**~~ **Resolved 2026-05-20: 7 days.**
3. **Slack `/compliance-discover` policy.** This command can run for ~2 min and post a long report. Should it post into the channel where invoked, DM the invoker, or always post into a dedicated `#compliance` channel?
