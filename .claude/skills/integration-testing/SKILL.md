---
name: integration-testing
description: Use when creating integration tests for agent workflows. Guides through git worktree isolation, selective mocking, test fixtures, and independent result verification.
---

# Creating Integration Tests for Agent Workflows

This skill guides you through creating integration tests that run real agents against real codebases to verify end-to-end behavior.

## When to Use This Skill

Use integration tests when:

- Testing agent workflows end-to-end (not just individual functions)
- Verifying generated code actually works
- Catching issues that unit tests can't find (real file I/O, real agent behavior)
- Testing the interaction between multiple components

**Not for:**

- Testing individual functions (use unit tests)
- Testing business logic in isolation (use unit tests)
- Quick feedback during development (too slow/expensive)

## Architecture Pattern

### Git Worktree Isolation

Integration tests run in isolated git worktrees to avoid polluting the main codebase:

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

const execFileAsync = promisify(execFile)

export interface WorktreeContext {
  path: string
  branch: string
  repoRoot: string
}

export async function createWorktree(
  repoRoot: string,
): Promise<WorktreeContext> {
  const timestamp = Date.now()
  const branch = `test/integration-${timestamp}`
  const worktreePath = path.join(tmpdir(), `studio-integration-${timestamp}`)

  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'],
    { cwd: repoRoot },
  )

  return { path: worktreePath, branch, repoRoot }
}

export async function cleanupWorktree(ctx: WorktreeContext): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', '--force', ctx.path], {
    cwd: ctx.repoRoot,
  }).catch(() => {})
  await execFileAsync('git', ['branch', '-D', ctx.branch], {
    cwd: ctx.repoRoot,
  }).catch(() => {})
}
```

**Benefits:**

- Complete isolation from main repo
- Real git environment for agent
- Easy cleanup with `git worktree remove`
- No risk of polluting main codebase

### Selective Mocking

Use dependency injection to mock external services while keeping core functionality real:

| Component       | Real | Mock | Why                            |
| --------------- | :--: | :--: | ------------------------------ |
| File operations |  ✓   |      | Testing real file I/O          |
| Agent execution |  ✓   |      | **This is what we're testing** |
| GitHub API      |      |  ✓   | Avoid real API calls           |
| Git push        |      |  ✓   | Don't push test branches       |
| Notifications   |      |  ✓   | No spam                        |

```typescript
function createIntegrationMockFunctions(): WorkflowFunctions {
  return {
    // Real implementations - what we're testing
    validateSpecFiles: validateSpecFilesExist,
    readProductSpec: readStateFileLocal,
    runAgent: runCodingAgent,

    // Mocked - external services
    commitAndPush: vi
      .fn()
      .mockReturnValue(
        okAsync({ success: true, filesChanged: [], commitSha: 'mock-sha' }),
      ),
    removeLabel: vi.fn().mockReturnValue(okAsync(undefined)),
    addComment: vi.fn().mockReturnValue(okAsync({ id: 1 })),
  }
}
```

## Test Fixture Design

Create self-contained, verifiable tasks:

```typescript
// fixtures.ts
export const PRODUCT_SPEC = `# Product Spec: LOC Counter Script

## Goal
Create a command-line script that counts lines of code in the repository.

## Acceptance Criteria
1. Script exists at \`scripts/loc.ts\`
2. Counts only non-blank lines
3. Excludes comment-only lines (starting with // or #)
4. Excludes \`node_modules/\`, \`dist/\`, \`.git/\` directories
5. Prints total count to stdout

## Out of Scope
- Multi-line comment detection
- Per-file breakdown
`

export const IMPL_SPEC = `# Implementation Spec: LOC Counter Script

## Technical Approach
Use glob or readdir to find TypeScript files, read each, filter blank/comment lines, sum counts.

## Files to Create
- \`scripts/loc.ts\`
`

export const DECISIONS = `# Decisions
No decisions recorded yet.
`
```

**Guidelines:**

- Task must be completable by the agent
- Result must be independently verifiable
- Keep scope small (5-10 minute implementation)
- Include clear acceptance criteria

## Result Verification (Critical)

**Never just check "it returned something"**. Independently verify correctness:

```typescript
it('script runs and produces correct LOC count', async () => {
  // Run the generated script
  const { stdout } = await execFileAsync('bun', ['scripts/loc.ts'], {
    cwd: worktree.path,
  })
  const count = parseInt(stdout.trim(), 10)

  // Independently compute expected result using shell commands
  const { stdout: expectedOutput } = await execFileAsync(
    'bash',
    [
      '-c',
      `find . -name "*.ts" -not -path "./node_modules/*" -not -path "./dist/*" -not -path "./.git/*" -print0 | xargs -0 cat 2>/dev/null | grep -v '^[[:space:]]*$' | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*#' | wc -l`,
    ],
    { cwd: worktree.path },
  )

  const expectedCount = parseInt(expectedOutput.trim(), 10)

  // Compare with tolerance for edge case differences
  const tolerance = Math.ceil(expectedCount * 0.05) // 5%
  expect(count).toBeGreaterThanOrEqual(expectedCount - tolerance)
  expect(count).toBeLessThanOrEqual(expectedCount + tolerance)
})
```

**Bad verification:**

```typescript
// ❌ Just checks it returned a number
expect(count).toBeGreaterThan(0)
```

**Good verification:**

```typescript
// ✓ Independently computes and verifies the actual value
const expected = computeExpectedValue()
expect(result).toBeCloseTo(expected, tolerance)
```

## Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const SKIP_INTEGRATION = process.env.INTEGRATION_TEST !== 'true'

describe.skipIf(SKIP_INTEGRATION)('My Workflow Integration', () => {
  let worktree: WorktreeContext

  beforeAll(async () => {
    // 1. Create isolated worktree
    worktree = await createWorktree(process.cwd())

    // 2. Set up test fixtures
    const studioDir = path.join(worktree.path, '.studio', TASK_DIR)
    await fs.mkdir(studioDir, { recursive: true })
    await fs.writeFile(path.join(studioDir, 'product-spec.md'), PRODUCT_SPEC)
    await fs.writeFile(
      path.join(studioDir, 'implementation-spec.md'),
      IMPL_SPEC,
    )

    // 3. Install dependencies
    await execFileAsync('bun', ['install'], { cwd: worktree.path })
  }, 180_000) // 3 minute setup

  afterAll(async () => {
    if (worktree) {
      await cleanupWorktree(worktree)
    }
  }, 30_000)

  it('runs workflow successfully', async () => {
    const result = await runWorkflow(deps, mockFns)
    // Assertions...
  }, 600_000) // 10 minute timeout

  it('created the expected files', async () => {
    // File existence checks
  })

  it('generated code produces correct output', async () => {
    // Run generated code and verify results independently
  })

  it('typecheck passes', async () => {
    await execFileAsync('bun', ['typecheck'], { cwd: worktree.path })
  }, 90_000)
})
```

## Authentication

### Local Development

The Claude SDK automatically uses config file authentication when no API keys are provided.
For local development, you can run tests without setting any credentials if you have
authenticated via `claude` CLI.

### CI Environment

Use secrets:

```yaml
env:
  INTEGRATION_TEST: 'true'
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## CI Workflow

Create a workflow that runs on demand and weekly:

```yaml
# workflows/integration-test.yml
name: Integration Tests

on:
  workflow_dispatch: # Manual trigger
  schedule:
    - cron: '0 2 * * 0' # Weekly Sunday 2am UTC

jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Full history for worktree

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - run: bun install --frozen-lockfile

      - name: Run integration tests
        env:
          INTEGRATION_TEST: 'true'
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: bun test:run actions/my-agent/tests/integration/
```

## Cost and Time Management

Set limits to prevent runaway costs:

```typescript
const deps = {
  // ...
  maxTurns: 50, // Prevent infinite loops
  maxBudgetUsd: 5, // Cap API costs
}
```

**Expectations:**

- Setup: 1-3 minutes (worktree creation, bun install)
- Agent execution: 3-10 minutes depending on task complexity
- Verification: 1-2 minutes
- Cost: $1-5 per run depending on agent and task

## Quick Start Checklist

When creating a new integration test:

- [ ] Create `tests/integration/` directory
- [ ] Create `worktree.ts` with create/cleanup utilities
- [ ] Create `fixtures.ts` with product spec + implementation spec
- [ ] Create main test file with `describe.skipIf(SKIP_INTEGRATION)`
- [ ] Use real file operations and agent, mock external services
- [ ] **Verify results independently** (shell commands, not just "truthy")
- [ ] Set appropriate timeouts (10min+ for agent tests)
- [ ] Add CI workflow with `workflow_dispatch` + `schedule`
- [ ] Test locally: `INTEGRATION_TEST=true bun test:run path/to/integration/`

## Reference Implementation

See `actions/coding-agent/tests/integration/` for a complete example:

- `worktree.ts` - Worktree creation/cleanup utilities
- `fixtures.ts` - Test specifications
- `implement-workflow.integration.test.ts` - Main test file

---

**Remember**: Integration tests are expensive (time + API costs). Use them to verify end-to-end behavior that unit tests can't catch. Always verify results independently - never just check "it returned something."
