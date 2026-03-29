# Testing Anti-Patterns

Read this when writing or changing tests, adding mocks, or tempted to add test-only methods to production code.

Tests must verify real behavior, not mock behavior. Mocks are a means to isolate, not the thing being tested.

## Anti-Pattern 1: Testing Mock Behavior

```typescript
// Bad: testing that the mock exists
it('calls the API', () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true })
  await fetchDonations(mockFetch)
  expect(mockFetch).toHaveBeenCalledTimes(1)
})
```

This test proves the mock was called, not that donations were fetched correctly. It passes even if `fetchDonations` does nothing useful with the response.

```typescript
// Good: testing real behavior
it('returns parsed donations from API response', () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ transactions: [{ id: 'tx_1', amount: 5000 }] }),
  })
  const result = await fetchDonations(mockFetch)
  expect(result.isOk()).toBe(true)
  expect(result.value).toEqual([{ id: 'tx_1', amount: 5000 }])
})
```

**Before asserting on any mock:** ask "Am I testing real behavior or just that the mock was invoked?"

## Anti-Pattern 2: Test-Only Methods in Production Code

```typescript
// Bad: destroy() only exists for test cleanup
class ConnectionPool {
  async destroy() {
    /* ... */
  }
}

// In tests:
afterEach(() => pool.destroy())
```

Production classes shouldn't have methods that only tests call. If accidentally called in production, they can cause real damage. Put test cleanup logic in test utilities instead.

```typescript
// Good: test utility handles cleanup
// In test-utils.ts
export async function cleanupPool(pool: ConnectionPool) {
  await pool.drain()
}
```

**Before adding a method to a production class:** ask "Is this only used by tests?" If yes, put it in test utilities.

## Anti-Pattern 3: Mocking Without Understanding Dependencies

```typescript
// Bad: over-mocking breaks the thing you're trying to test
it('detects duplicate records', () => {
  vi.mock('./bigquery-client', () => ({
    queryExisting: vi.fn().mockResolvedValue([]), // Oops — test depends on this!
  }))
  // Duplicate detection can't work if queryExisting always returns empty
})
```

Before mocking a dependency, understand its side effects and which of them your test depends on. Mock at the lowest level needed (the actual slow/external operation), not the high-level function your test relies on.

**Before mocking any method:**

1. What side effects does the real method have?
2. Does this test depend on any of those side effects?
3. What's the minimal mock that preserves the behavior the test needs?

## Anti-Pattern 4: Incomplete Mocks

```typescript
// Bad: only mocking fields you think you need
const mockApiResponse = {
  id: 'tx_123',
  amount: 5000,
  // Missing: status, createdAt, counterpartyName...
}
```

Partial mocks hide structural assumptions. Downstream code may depend on fields you didn't include, causing silent failures in production that tests didn't catch.

Mirror the real data structure completely. Use factory functions (like `makeMercuryTransaction()`) that return full, realistic objects and let individual tests override specific fields.

## Anti-Pattern 5: Tests as an Afterthought

```
Code written -> "Now I need to add tests" -> Tests written to match the code
```

Tests written after implementation are biased by the implementation. You test what you built, not what's required. You verify edge cases you remembered, not ones you would have discovered.

This is why TDD exists: tests written first define what the code should do. Tests written after verify what the code happens to do. These are not the same thing.

## Anti-Pattern 6: Tests That Test the Framework

```typescript
// Bad: testing that Zod works
it('validates the schema', () => {
  expect(() => Schema.parse(validData)).not.toThrow()
  expect(() => Schema.parse(invalidData)).toThrow()
})
```

Don't test that Zod parsing works — Zod's own tests cover that. Test what your code does with the parsed result, or how it handles the specific validation error.

```typescript
// Good: testing your code's behavior with valid/invalid data
it('returns validation error for missing donor name', () => {
  const result = processTransaction({ ...validTx, counterpartyName: null })
  expect(result.isErr()).toBe(true)
  expect(result.error.message).toContain('donor name')
})
```

## When Mocks Become Too Complex

Warning signs:

- Mock setup is longer than the test logic
- You're mocking everything just to make the test run
- The mock is missing methods the real component has
- Test breaks when mock changes, not when code breaks

If mocking is painful, the code is too coupled. Consider dependency injection or simplifying the interface. Sometimes an integration test with real components is simpler and more trustworthy than a unit test with complex mocks.

## Quick Reference

| Anti-Pattern                    | Fix                                              |
| ------------------------------- | ------------------------------------------------ |
| Assert on mock invocations only | Assert on return values and behavior             |
| Test-only methods in production | Move to test utilities                           |
| Mock without understanding deps | Understand side effects first, mock minimally    |
| Incomplete mocks                | Use factory functions with full realistic data   |
| Tests after implementation      | Write tests first (TDD)                          |
| Testing the framework           | Test your code's behavior, not library internals |
