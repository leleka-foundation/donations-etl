---
name: tdd
description: Use when writing new features, adding tests, or fixing coverage gaps. Guides through TDD workflow (red-green-refactor) and branch coverage patterns to achieve 100% test coverage.
---

# Test-Driven Development (TDD) Skill

This skill guides you through test-driven development with 100% coverage.

## When to Use

- Writing new features or workflows
- Adding tests to existing code
- Fixing coverage gaps
- Before committing code with new functionality

## Red-Green-Refactor Workflow

### 1. RED: Write a Failing Test First

- Identify the behavior to implement
- Write a test that defines the expected behavior
- Run `bun test:run` - the test should FAIL
- If it passes, your test isn't testing what you think

### 2. GREEN: Minimum Code to Pass

- Write the minimum code to make the test pass
- Don't over-engineer - just make it work
- Run `bun test:run` - the test should PASS

### 3. REFACTOR: Clean Up

- Improve code quality while keeping tests green
- Run `bun test:run` after each change

## Branch Coverage Patterns

Every conditional creates branches. Write tests for BOTH:

| Pattern     | Branches | Tests Needed          |
| ----------- | -------- | --------------------- |
| `a ? b : c` | 2        | Truthy and falsy      |
| `a ?? b`    | 2        | Defined and undefined |
| `a \|\| b`  | 2        | Truthy and falsy      |
| `a && b`    | 2        | Truthy and falsy      |

### Testing Ternary Expressions

For code like:

```typescript
const msg = output ? `Output: ${output}` : ''
```

Write TWO tests:

```typescript
// Test 1: truthy branch
it('includes output when present', () => {
  // Setup with output: 'value'
  expect(result).toContain('Output:')
})

// Test 2: falsy branch
it('omits output when absent', () => {
  // Setup with output: undefined
  expect(result).not.toContain('Output:')
})
```

### Testing Nullish Coalescing

For code like:

```typescript
serverUrl: deps.serverUrl ?? 'https://github.com'
```

Write TWO tests:

```typescript
// Test 1: value provided
it('uses provided serverUrl', () => {
  const deps = { serverUrl: 'https://custom.com' }
  expect(result.serverUrl).toBe('https://custom.com')
})

// Test 2: value undefined
it('uses default when not provided', () => {
  const deps = { serverUrl: undefined }
  expect(result.serverUrl).toBe('https://github.com')
})
```

### Testing Optional Object Patterns

For code like:

```typescript
runContext: deps.runId
  ? { runId: deps.runId, serverUrl: deps.serverUrl ?? 'https://github.com' }
  : undefined
```

Write THREE tests:

1. `runId` not provided → `runContext` is `undefined`
2. `runId` provided with `serverUrl` → uses provided values
3. `runId` provided without `serverUrl` → uses default serverUrl

## Verification Sequence

**Before committing new code:**

```bash
bun typecheck        # Type safety
bun lint             # Code style
bun test:coverage    # Tests AND coverage (100% required)
```

**NEVER** use `bun test:run` for final verification - it doesn't check coverage.

## Copy Patterns from Existing Tests

Before writing tests for a new workflow:

1. Find similar code in `actions/*/`
2. Read their tests in `actions/*/tests/unit/`
3. Copy the test structure

**Example:** For optional `runId`/`serverUrl`:

- See `actions/coding-agent/tests/unit/impl-spec-workflow.test.ts` lines 381-438

Search for patterns:

```bash
grep -n "runId\|serverUrl\|lastOutput" actions/*/tests/**/*.test.ts
```

## Quick Checklist

Before committing:

- [ ] Every ternary `a ? b : c` has tests for BOTH branches
- [ ] Every nullish coalescing `a ?? b` has tests for defined AND undefined
- [ ] `bun test:coverage` shows 100% for all columns
- [ ] No istanbul ignore comments added (write tests instead)

## Common Mistakes to Avoid

1. **Running `bun test:run` instead of `bun test:coverage`**
   - `test:run` doesn't check coverage - pre-commit will fail

2. **Using istanbul ignore comments**
   - This violates "never relax guardrails"
   - Write proper tests instead

3. **Not testing both branches**
   - Every `?` or `??` needs at least 2 tests

4. **Not copying patterns from existing tests**
   - The codebase has examples for every pattern you need
