# Code Reuse

Code reuse reduces bugs, improves maintainability, and ensures consistency. Always prefer using existing, tested code over writing new implementations.

## Core Principles

### 1. Search Before You Implement

**Before writing any new function or logic, always search for existing implementations:**

- Use Grep to search for similar patterns in the codebase
- Check `actions/shared/` directory for reusable utilities
- Search dependencies in `package.json` for library solutions
- Look in Node.js/Bun standard libraries for built-in functions
- Review related files for similar functionality

**Example searches:**

```bash
# Search for existing validation logic
grep -r "validate" --include="*.ts"

# Find files with similar functionality
glob "**/*validation*.ts"

# Check shared utilities
ls actions/shared/
```

### 2. Break Code into Small, Pure Functions

Small, pure functions are:

- **Easier to test** - Single responsibility, predictable outputs
- **More reusable** - Can be composed in different contexts
- **Simpler to understand** - Clear inputs and outputs
- **Better for discovery** - Named functions are searchable

**Bad - Inline logic:**

```typescript
// Hard to reuse, hard to test
function processUser(user: any) {
  const name = user.firstName + ' ' + user.lastName
  const initials = user.firstName[0] + user.lastName[0]
  return { name, initials }
}
```

**Good - Extracted, pure functions:**

```typescript
// Reusable, testable, discoverable
function formatFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName[0]}${lastName[0]}`
}

function processUser(user: User) {
  return {
    name: formatFullName(user.firstName, user.lastName),
    initials: getInitials(user.firstName, user.lastName),
  }
}
```

### 3. Use Clear, Descriptive Names

Function names should clearly describe what they do, making them easy to discover when searching:

- **Good**: `formatDuration`, `parseGitHubUrl`, `validateIssueNumber`, `truncateString`
- **Bad**: `format`, `parse`, `validate`, `truncate`

More specific names prevent accidental misuse and help others find your functions.

### 4. Leverage Standard Libraries

Don't reinvent the wheel. Standard libraries are tested, optimized, and maintained:

**Bad - Custom implementation:**

```typescript
// Reinventing file operations
async function copyDir(src: string, dest: string) {
  // Custom recursive copy logic...
}
```

**Good - Use standard library:**

```typescript
import { cp } from 'node:fs/promises'

// Built-in, tested, and optimized
await cp(src, dest, { recursive: true })
```

**Common standard library utilities:**

- `node:fs/promises` - File operations (read, write, copy, delete)
- `node:path` - Path manipulation (join, resolve, dirname)
- `node:crypto` - Hashing and encryption
- Array methods - `map`, `filter`, `reduce`, `find`, `some`, `every`

### 5. Check Dependencies

Before implementing generic functionality, check if it's already in your dependencies:

**Example from Studio codebase:**

- **Logging**: Use `pino` (already in dependencies)
- **Date/time**: Use `luxon` (already in dependencies)
- **Validation**: Use `Zod` (already in dependencies)
- **HTTP requests**: Use `@octokit/rest` for GitHub API

Check `package.json` and search for the library's documentation before implementing.

### 6. Refactor When You Create Reusable Code

When you create a new reusable function, search for similar code that could be refactored to use it:

1. Implement the new, general-purpose function
2. Search the codebase for similar patterns
3. Refactor found instances to use the new function
4. Update tests to verify the refactoring

**Important**: This keeps the codebase DRY and prevents future duplication.

## Studio-Specific Guidelines

### Check `actions/shared/` First

Studio maintains shared utilities in `actions/shared/`:

- `agent-output.ts` - Formatting, truncation, type guards (`formatDuration`, `truncate`, `isRecord`)
- `github.ts` - GitHub API wrappers (issues, PRs, files, labels)
- `git.ts` - Git operations (branch creation, commits, pushes)
- `state.ts` - `.studio/` file operations (reading/writing specs, task directories)
- `labels.ts` - Label constants and helpers
- `errors.ts` - Custom error types
- `result.ts` - Result type for error handling
- `escalation.ts` - Escalation and blocking logic
- `comment.ts` - PR/issue comment formatting

**Before creating a new utility, check if it belongs in one of these files.**

### Common Patterns in Studio

1. **GitHub API calls**: Use wrappers from `github.ts`, don't call Octokit directly
2. **File operations**: Use helpers from `state.ts` for `.studio/` files
3. **Error handling**: Use `Result<T>` type from `result.ts`
4. **Logging**: Import from `logger.ts`, use structured logging with Pino
5. **Input validation**: Use Zod schemas from `schemas.ts`

## Integration with Other Rules

This rule complements existing principles:

- **Fundamental Principles**: "Never trust your training data" → Always search for current implementations in the codebase
- **Testing**: Small, pure functions achieve 100% test coverage more easily
- **Code Style**: Reuse reduces complexity and keeps code simple
- **Dependencies**: Check library docs before implementing something generic

## Workflow Summary

When implementing new functionality:

1. **Search** - Grep/Glob for similar code in the codebase
2. **Check shared** - Look in `actions/shared/` for existing utilities
3. **Check dependencies** - Review `package.json` and library docs
4. **Check standard library** - Look for built-in Node.js/Bun functions
5. **Implement** - If nothing exists, write a small, pure, well-named function
6. **Refactor** - Find and update similar code to use the new function
7. **Test** - Write comprehensive tests for the new code
