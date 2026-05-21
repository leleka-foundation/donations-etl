# Compliance MCP + Plugin — Implementation Checklist

Companion to [`PLAN.md`](./PLAN.md). Tick each item as it lands. Every step ends with `bun typecheck && bun lint && bun test:run` all green, and a focused commit.

Branch: `feat/compliance-mcp-and-plugin`

**Status (2026-05-21):** all steps complete. Branch pushed and PR opened.

---

## Step 1 — Branch + scaffold

- [x] Create branch `feat/compliance-mcp-and-plugin`.
- [x] Write `docs/compliance-mcp/PLAN.md`.
- [x] Write `docs/compliance-mcp/CHECKLIST.md`.
- [x] Commit `chore(compliance-mcp): add plan + checklist`.

## Step 2 — Backend extensions (no MCP yet)

### 2a. `discovery_jobs` table + `job_id` on `discovery_runs`

- [x] Add Zod schema + types for `discovery_jobs` rows in `src/compliance/types/` (or extend existing types module).
- [x] Add `job_id STRING NULLABLE` column to `discovery_runs` schema (existing migration code).
- [x] Add `discovery_jobs` table to migration (`src/compliance/skills/migrate.ts` + tests).
- [x] Implement `createDiscoveryJobsAccessor` in `src/compliance/state/bq-jobs.ts` (write + read job rows).
- [x] Tests for migration + accessor (mocked BQ port).

### 2b. `discover-job` pure backend

- [x] `src/compliance/skills/discover-job.ts` — exports `startDiscoveryJob`, `readDiscoveryJobStatus`, `readDiscoveryJobResult`. Port-shaped: takes accessors + a job-id-tagging recorder + a "spawn discovery" callback.
- [x] `src/compliance/skills/discover-job-wiring.ts` — production wiring; defaults the spawn callback to `runDiscoveryProduction` invoked fire-and-forget with a `RunRecorder` decorator that tags each row with `job_id`.
- [x] Tests cover: happy path (start → status running → status completed → result), failure path (spawn throws → job marked failed), filter parameters (sources / jurisdictionId), `confirm:true` gate.

### 2c. `onboard-update` pure backend

- [x] `src/compliance/skills/onboard-update.ts` — exports `runOnboardingUpdate` accepting a partial `OnboardingAnswers`. Merges with the currently-stored entity + identifiers; persists the merged result; rejects if the entity is not yet onboarded.
- [x] `src/compliance/skills/onboard-update-wiring.ts` — `runOnboardingUpdateProduction`.
- [x] Tests cover: partial update on top of existing onboarding, rejection when no entity exists, validation errors propagate.

- [x] Commit `feat(compliance): add discovery_jobs + onboard-update backends`.

## Step 3 — MCP read surface

- [x] `apps/mcp/src/tools/compliance/status.ts` — `handleComplianceStatus` wraps `getComplianceStatusProduction`.
- [x] `apps/mcp/src/tools/compliance/resources.ts` — `buildStatusResource`, `buildSourceRegistryResource`, `buildInterviewQuestionsResource`.
- [x] `apps/mcp/src/tools/compliance/index.ts` — `registerComplianceSurface(mcp, deps)` registers the tool + the three resources. Called from `main.ts` (added in step 9).
- [x] Tests in `apps/mcp/tests/compliance/`:
  - `status.test.ts` (mock wiring fn).
  - `resources.test.ts` (each resource returns the expected JSON shape).
- [x] Verify result-content shape matches what the existing `query-bigquery` tool returns (text + structured content).

- [x] Commit `feat(mcp): expose compliance read surface (status + resources)`.

## Step 4 — MCP write surface — onboarding

- [x] `apps/mcp/src/tools/compliance/onboard.ts` — `handleComplianceOnboard` (full submit, `confirm: true`) and `handleComplianceOnboardUpdate` (partial, `confirm: true`).
- [x] Register both in `registerComplianceSurface`.
- [x] Tests cover: missing `confirm` rejected, full submit happy path (with mocked wiring), partial update happy path, validation errors surface correctly.

- [x] Commit `feat(mcp): expose compliance onboarding tools`.

## Step 5 — MCP write surface — evidence

- [x] Extend `resources.ts` with `buildManualEvidenceInstructions(sourceId)` — ResourceTemplate. Generates instructions from `SourceManualEvidenceField[]` in the registry.
- [x] `apps/mcp/src/tools/compliance/record-evidence.ts` — `handleComplianceRecordEvidence` (with `confirm: true`).
- [x] Register in `registerComplianceSurface`.
- [x] Tests cover: instructions resource for a known sourceId, instructions resource for an unknown sourceId returns a structured "not found" response, submit tool happy path, missing-confirm rejected.

- [x] Commit `feat(mcp): expose compliance evidence tool + manual instructions resource`.

## Step 6 — MCP async discover surface

- [x] `apps/mcp/src/tools/compliance/discover.ts` — three handlers: `handleComplianceDiscoverStart`, `handleComplianceDiscoverStatus`, `handleComplianceDiscoverResult`. All wired to step-2b backends.
- [x] Register in `registerComplianceSurface`.
- [x] Tests cover full lifecycle through the handlers (using in-memory fake job + run accessors).

- [x] Commit `feat(mcp): expose async compliance discover tools`.

## Step 7 — `compliance-overview` prompt

- [x] `apps/mcp/src/tools/compliance/prompt.ts` — `buildComplianceOverviewPrompt(config)` returns the prompt text. Mirrors `donations-prompt.ts`.
- [x] Register prompt in `registerComplianceSurface`.
- [x] Test asserts the prompt text contains references to every tool and every resource (so a regression is caught when a new tool is added but the overview isn't updated).

- [x] Commit `feat(mcp): add compliance-overview prompt`.

## Step 8 — Plugin marketplace + two plugins

- [x] Verify whether Claude Code's `.mcp.json` parser supports env var substitution — search docs, document the answer in PLAN.md "Open question" section. Decide whether to use `${DONATIONS_MCP_URL}` or a placeholder URL.
- [x] Verify whether two plugins each declaring the same MCP server URL leads to dedup or duplicate sessions in Claude Code — empirical test. Decide whether to keep `.mcp.json` in both or only in core.
- [x] `.claude-plugin/marketplace.json` — name `donations-etl`, owner `vgeshel/donations-etl`, plugins `donations-etl-core` and `donations-etl-compliance`.
- [x] `plugins/donations-etl-core/.claude-plugin/plugin.json` (name, version `0.1.0`, displayName, description, repository, license, keywords).
- [x] `plugins/donations-etl-core/.mcp.json` (per decision above).
- [x] `plugins/donations-etl-core/skills/` symlinks for core skills listed in PLAN.md.
- [x] `plugins/donations-etl-core/README.md`.
- [x] `plugins/donations-etl-compliance/.claude-plugin/plugin.json`.
- [x] `plugins/donations-etl-compliance/.mcp.json` (per decision above).
- [x] `plugins/donations-etl-compliance/skills/` symlinks for compliance skills.
- [x] `plugins/donations-etl-compliance/README.md`.
- [x] Manifest-validation tests in `tests/plugins/manifest.test.ts` — load each `plugin.json` + `marketplace.json`, validate against the published JSON Schema.

- [x] Commit `feat(plugins): add donations-etl marketplace with core + compliance plugins`.

## Step 9 — Wire-up in `main.ts`

- [x] Import `registerComplianceSurface` from `apps/mcp/src/tools/compliance/index.ts`.
- [x] Call it inside `createMcpServerInstance()` alongside the existing donations tools.
- [x] Update server capabilities to include `resources: {}` (the existing capabilities only declared `tools` + `prompts`).
- [x] Smoke-test locally: `bun run --cwd apps/mcp src/main.ts`, open an MCP session, list tools/resources/prompts, confirm compliance items appear.

- [x] Commit `feat(mcp): register compliance surface in server entry`.

## Step 10 — Docs + final sanity

- [x] Cross-reference: add a "See also" line in `docs/compliance/PLAN.md` pointing at `docs/compliance-mcp/PLAN.md`.
- [x] Brief note in repo README (if one exists) about the marketplace install command.
- [x] Full sweep: `bun typecheck && bun lint && bun test:run` from repo root, all green.
- [x] Push branch; open PR; copy the PLAN summary into the PR description; include a screenshot of the local MCP session listing the new tools/resources/prompts.

- [x] Final commit `docs(compliance-mcp): cross-references + readme note`.

---

## Acceptance gates (every commit)

- `bun typecheck` — no errors.
- `bun lint` — no errors, no warnings on new files.
- `bun test:run` — all tests pass; new files at 100% line + branch coverage.
- No `any`, no `as` (except documented JSONB), no `throw` in production code (use `Result`/`ResultAsync`).
- Every external data input validated with Zod.
- No commits to `main`. PR opened from `feat/compliance-mcp-and-plugin`.
