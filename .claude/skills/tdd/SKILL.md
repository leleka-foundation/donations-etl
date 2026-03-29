---
name: tdd
description: >
  Use when implementing any feature, fixing any bug, or investigating any problem — before writing production code.
  This skill MUST be used whenever: writing new code, debugging issues, a user reports a problem, you see errors in
  logs, data looks wrong in BigQuery or any destination, a test is failing, behavior doesn't match expectations,
  or you're about to change existing code for any reason. The core rule is simple: reproduce the problem or define
  the behavior with a failing test BEFORE writing or changing production code. Use this even for "quick fixes" —
  especially for quick fixes.
---

# Test-Driven Development

Write the test first. Watch it fail. Write minimal code to pass.

If you didn't watch the test fail, you don't know if it tests the right thing.

## The Two Workflows

### Workflow 1: Building Something New

You're adding a feature, a function, a connector — anything that doesn't exist yet.

1. **Understand the behavior** — What should this code do? What inputs does it take? What outputs should it produce? What can go wrong?
2. **Enumerate test scenarios** — Before writing any code, use the scenario checklist below to build the full list of tests. Write them all out. This is the most important step.
3. **RED** — Write the first failing test. Run it. Watch it fail for the right reason.
4. **GREEN** — Write minimal code to pass. Nothing more.
5. **Repeat** — Next test, next implementation. One test at a time.
6. **REFACTOR** — Once all tests pass, clean up. Tests stay green.

### Workflow 2: Fixing a Problem

Someone reports incorrect data, you see an error in logs, a transformation produces wrong results, records are missing — any problem at all.

**Reproduce first. Fix second.**

1. **Understand the problem** — What's wrong? What was expected? Get a concrete example (a specific transaction ID, a log line, a data sample).
2. **Write a failing test that reproduces it** — Use realistic data from the actual problem. The test should fail in the same way the production code fails. If you can't reproduce it in a test, you don't understand the problem yet.
3. **Verify the test fails for the right reason** — The failure message should describe the actual bug, not a typo or missing import.
4. **Expand the radius** — This is the step people skip. Before fixing anything, ask: "What are the _adjacent_ inputs that might also break?" If `null` crashed the code, also test empty string `""`, whitespace-only `"  "`, and `undefined`. If a number conversion is wrong for 5000, also test 0, negative numbers, very large numbers, and fractional values. Write tests for these adjacent cases now, while you're thinking about the problem. Some will pass (the code already handles them) — that's fine, those are regression guards. Some will fail — that means you found more bugs.
5. **Fix the code** — Minimal change to make all the tests pass.
6. **Verify all tests pass** — The fix shouldn't break anything else.

The "expand the radius" step is what separates a fix that holds from a fix that spawns two more bugs. A bug in one input variant almost always means neighboring variants are fragile too.

## Scenario Checklist

Before writing tests for any function, walk through each category. Not every category applies to every function — but think about each one before dismissing it.

### The Essentials (every function)

- **Happy path with realistic data** — Not `{ name: "test" }`. Use actual field names, realistic amounts, real date formats from the codebase.
- **Second happy path** — A different valid input that exercises a different code path. If the function handles ACH and wire transfers, test both.

### Inputs That Break Things (external data)

When a function processes data from APIs, files, or user input:

- **null** where a value is expected
- **Empty string** `""` — this is different from null and often handled differently
- **Whitespace-only** `"  "` or `"\t\n"` — looks truthy but contains nothing useful
- **Wrong type** — string where number expected, number where string expected
- **Extra fields** the API didn't document but sends anyway
- **Missing fields** the API docs say are required but sometimes omit
- **Unicode** — accented characters in names, emoji in descriptions, RTL text
- **HTML entities** — `&amp;` in descriptions, `<script>` tags in user input

### Boundaries

- **Zero** — zero amounts, zero-length arrays, zero-character strings
- **Exactly at the limit** — if a window is 24 hours, test at exactly 24:00:00
- **One past the limit** — 24:00:01, one over the max, array length + 1
- **One before the limit** — 23:59:59, one under the max
- **Negative values** — where only positive are expected
- **Very large values** — amounts in the millions, strings with 10K characters
- **Fractional values** — 100.5 cents, 0.001 dollars

### Time and Dates

- **Timezone mismatches** — UTC vs local, missing timezone suffix
- **Daylight saving transitions** — the hour that doesn't exist, the hour that repeats
- **Year/month/day boundaries** — Dec 31 to Jan 1, end of February
- **Different date formats** from the same API — ISO 8601 with and without milliseconds
- **The gap** between "created" and "processed" dates

### State and Ordering

- **Idempotency** — run the same input twice, get the same output
- **Order dependence** — does the output change if inputs arrive in different order?
- **Duplicates in input** — the same record appears twice
- **Empty input** — empty array, empty object, no records to process
- **Single item** — array with exactly one element (off-by-one bugs hide here)

### Error Scenarios (for functions calling external services)

- **Network timeout** or connection refused
- **Rate limit** (HTTP 429) — does the code retry or fail?
- **Auth token expired** — does the code surface a clear error?
- **Partial response** — API returns some records but errors mid-page
- **200 OK with error in body** — some APIs do this
- **Response schema changed** — extra/missing/renamed fields

### The Cross-Check

After writing your test list, scan it against the production code:

- Every `if`, `?`, `??`, `||`, `&&` is a branch. Do you have tests for both sides?
- Every `catch` block is an error path. Do you have a test that hits it?
- Every parameter with a default value — do you test with and without providing it?
- Every `.nullable()` in a Zod schema — do you test with the value AND with null?

## Red-Green-Refactor Mechanics

### RED: Write a Failing Test

Write one test that describes one behavior.

Run it:

```bash
bun test:run -- path/to/test.ts
```

**The test must fail.** If it passes, you're testing existing behavior. Rewrite it.

**The test must fail for the right reason.** "Function not found" is a compile error, not a behavior failure. "Expected error but got ok()" is a behavior failure — that's what you want.

### GREEN: Minimal Code to Pass

Write the simplest code that makes the test pass. Don't add features you haven't tested yet.

### REFACTOR: Clean Up

Tests are green. Now improve code quality. Run tests after each change.

## Verification

**Before committing any code:**

```bash
bun typecheck        # Type safety — must pass with zero errors
bun lint             # Code style — must pass with zero errors
bun test:coverage    # Tests AND coverage — 100% required
```

Use `bun test:coverage`, not `bun test:run`, for final verification.

## Avoid Empty Tests

A test that doesn't assert on specific values proves nothing:

```typescript
// Bad: proves nothing
it('processes data', () => {
  expect(() => processData(input)).not.toThrow()
})

// Good: proves specific behavior
it('sums donations by donor for the fiscal year', () => {
  const result = processData([
    { donor: 'Alice', amount: 100, date: '2024-03-15' },
    { donor: 'Alice', amount: 200, date: '2024-07-20' },
    { donor: 'Bob', amount: 50, date: '2024-01-10' },
  ])
  expect(result).toEqual([
    { donor: 'Alice', total: 300, count: 2 },
    { donor: 'Bob', total: 50, count: 1 },
  ])
})
```

## When Stuck

| Problem                           | Solution                                                      |
| --------------------------------- | ------------------------------------------------------------- |
| Don't know what to test           | Write the API you wish existed. Start with the assertion.     |
| Test is too complicated           | The code's interface is too complicated. Simplify the design. |
| Can't reproduce the bug in a test | You don't understand the bug yet. Get more data.              |
| Need to mock everything           | Code is too coupled. Use dependency injection.                |
| Test setup is huge                | Extract test helpers. If still complex, simplify the code.    |

## Anti-Patterns

When adding mocks or test utilities, read `references/testing-anti-patterns.md` to avoid:

- Testing mock behavior instead of real behavior
- Adding test-only methods to production code
- Mocking without understanding what the test depends on
- Incomplete mocks that hide structural assumptions
