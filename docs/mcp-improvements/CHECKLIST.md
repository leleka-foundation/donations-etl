# MCP Server Improvements — Checklist

Companion to `PLAN.md`. Tick items as they land.

## Workstream 1 — Disconnect fix

PR: [leleka-foundation/nonprofit-toolkit#18](https://github.com/leleka-foundation/nonprofit-toolkit/pull/18) (draft).

### Diagnostic logging — shipped 2026-05-18 (commit `66dd3c6`)

- [x] Export `tokenFingerprint(token)` from `apps/mcp/src/auth/storage.ts`.
- [x] Add structured logging at every decision point in `apps/mcp/src/auth/provider.ts` (`exchangeRefreshToken`, `exchangeAuthorizationCode`, `verifyAccessToken`, `revokeToken`).
- [x] Create `apps/mcp/src/auth/audit-log.ts` with `summarizeTokenRequest` + `tokenAuditLogger` middleware (Zod-validated, no secret values in logs).
- [x] Mount `tokenAuditLogger` before `mcpAuthRouter` for `/token` in `apps/mcp/src/main.ts`.
- [x] Tests: 16 audit-log + 9 new provider diagnostic tests + 4 fingerprint tests. 100% coverage on new files.
- [x] Deployed (revision `mcp-server-00022-6mm`); smoke-tested with a bogus refresh-token POST and confirmed audit log fired with correct fingerprint.

### Access-token TTL — shipped 2026-05-20 (commit `b244572`)

- [x] Change `TOKEN_LIFETIME_S` in `apps/mcp/src/auth/provider.ts` from `3600` to `7 * 24 * 60 * 60` with explanatory comment.
- [x] Update unit tests to assert the new `expires_in` value.
- [x] Verify refresh-token flow still rotates correctly with the new lifetime.
- [x] Deployed (revision `mcp-server-00023-b7z`).

### Resource-metadata discovery — open, low priority

- [ ] Confirm whether claude.ai actually relies on `GET /.well-known/oauth-protected-resource/mcp`. If yes, route the suffix to the canonical metadata handler. If not, document why the 404 is harmless and close.
- [ ] Add a regression test for whichever decision we make.

### Cloud Run configuration — deferred

These were on the original plan; with the TTL fix they appear unnecessary. Revisit only if production observation shows a residual disconnect signal.

- [ ] ~~Enable session affinity~~ — deferred.
- [ ] ~~Set CPU always allocated~~ — deferred.
- [x] Leave `min-instances` at 0 (scale-to-zero) — confirmed; keep costs down.

### Stateless transport — deferred

Same rationale; revisit only if needed.

- [ ] ~~Switch `StreamableHTTPServerTransport` to stateless mode~~ — deferred.

### Acceptance + observation

- [x] `bun typecheck` zero errors.
- [x] `bun lint` zero errors, zero warnings.
- [x] `bun test:run` all green (2447 pass, +29 over baseline).
- [x] `bun test:coverage` 100% on all new/changed files in `apps/mcp/`.
- [x] Cloud Build + deploy.
- [x] Draft PR opened.
- [ ] **Production observation, 1–2 weeks**: monitor `/token` and `/mcp` logs. Success criterion: no spontaneous "connector disabled" reports and no daily 400-burst pattern. If a disconnect recurs, pull the matching audit-log / provider log lines to identify which path failed; fix follows from the signal.
- [ ] **Promote PR out of draft** once observation passes.

## Workstream 2 — Compliance access for non-engineers

**Not started.**

### MCP tools

- [ ] RED: tests for `apps/mcp/src/tools/compliance-status.ts` covering OK, `not_onboarded`, and error paths (mock `getComplianceStatusProduction`).
- [ ] GREEN: implement `compliance-status` handler.
- [ ] Register `compliance-status` in `apps/mcp/src/main.ts` with Zod input schema and a clear `description`.
- [ ] Repeat RED → GREEN → register for `compliance-discover` (`runDiscoveryProduction`).
- [ ] Repeat RED → GREEN → register for `compliance-record-evidence` (`recordComplianceEvidenceProduction`); validate `sourceId` + `evidence` inputs strictly.
- [ ] Add an MCP prompt `compliance-overview` describing how to interpret findings and walk through `Action Required` items.

### Playwright in the deployed image

- [ ] Verify Playwright + Chromium actually launch inside the `mcp-server` container as built today (run `compliance-discover` against a Phase 2 source from the deployed revision).
- [ ] If broken: adjust the `apps/mcp/Dockerfile` (Chromium path / Playwright install) and bake a known-good revision. Add a deployed-image smoke test.
- [ ] If unfixable in MCP container: document fallback (Cloud Run Job + tool that triggers + polls) and adjust the PR scope.

### Slack commands

- [ ] Add `apps/slack-bot/src/slack/commands/compliance-status.ts` following `donor-letter.ts` pattern; acknowledge within 3s, post the markdown report.
- [ ] Add `compliance-discover.ts` similarly. Decide posting target per user answer (DM / channel / `#compliance`).
- [ ] Register both commands in the slack-bot manifest / wiring as appropriate.
- [ ] Tests for command handlers (mock the wiring functions, assert posted blocks).

### Teammate docs

- [ ] Write `docs/mcp-improvements/TEAM-SETUP.md` with:
  - Claude.ai connector setup (URL, Google sign-in, first prompts to try).
  - Cowork connector setup (pending user clarification on the mechanism).
  - Slack commands list.
- [ ] Link the doc from the project README under a new "Team access" section.

### Acceptance + deploy

- [ ] `bun typecheck` zero errors.
- [ ] `bun lint` zero errors, zero warnings.
- [ ] `bun test:run` all green.
- [ ] `bun test:coverage` 100% on all new/changed files.
- [ ] Cloud Build + deploy `mcp-server` and `slack-bot`.
- [ ] Manual smoke test from Claude.ai: list tools, run `compliance-status`, run `compliance-discover`, run `compliance-record-evidence` for one source. Capture screenshots for PR.
- [ ] Manual smoke test of Slack commands in a dev channel.
- [ ] Open PR. Title: `mcp+slack: expose compliance to non-engineer teammates`.

## Cross-PR hygiene

- [x] Keep `docs/mcp-improvements/PLAN.md` and `CHECKLIST.md` reflective of actual state. Last revision: 2026-05-20.
- [ ] After both PRs merge, update `MEMORY.md` (auto-memory) to note that compliance tools are now reachable via MCP + Slack, so future skills don't assume "local only".
