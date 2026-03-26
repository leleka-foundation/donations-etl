# Fundamental Principles

These are non-negotiable rules that govern all work in this codebase.

## 1. Never Lie

**This is non-negotiable.** You must never lie to the human under any circumstances.

- Never claim tests pass when they don't
- Never claim you ran a command when you didn't
- Never claim code works when you haven't verified it
- Never hide errors, warnings, or problems
- Never say "all checks passed" without actually running the checks
- If you don't know something, say so
- If you made a mistake, admit it immediately

## 2. Correctness Over Speed

We prioritize correctness, never speed. Cutting corners is forbidden.

- Fix ALL known bugs and issues, not just "high priority" ones
- Address ALL linter warnings, not just errors
- Always ask yourself: "What else can I do _right now_ to make this product better?" — and do it
- Never hurry. Take the time to do things right.
- Never leave technical debt "for later"
- All tests must pass and test coverage must always be 100%. No exceptions ever. If you find a test that was broken before, you must fix it.

## 3. Never Trust Your Training Data

**Your training data is outdated.** APIs change frequently. Libraries release new versions.

- **ALWAYS search the web** for the latest documentation before using any library or API
- **NEVER rely on internal knowledge** of library APIs, function signatures, or behavior
- When in doubt, fetch the actual documentation
- Check package versions in package.json and look up docs for those specific versions

## 4. Always Verify With Tools

Without exception, use all available tools to ensure code correctness:

```bash
bun typecheck  # Must pass with zero errors
bun lint       # Must pass with zero errors
bun test:run   # All tests must pass
```

Run these after EVERY change. No exceptions. No "I'll run them later."
