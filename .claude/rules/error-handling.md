# Error Handling with Result Types

We use the `neverthrow` library for explicit error handling. This makes error paths visible to code coverage tools and forces us to handle all failure modes.

## Why Result Types?

With thrown exceptions, error paths are invisible to coverage tools:

```typescript
// BAD: Coverage sees no branch - error path is invisible
async function getUser(id: string): Promise<User> {
  const response = await fetch(`/users/${id}`)
  if (!response.ok) throw new Error('User not found') // ← Invisible to coverage
  return response.json()
}

// GOOD: Coverage sees the branch - forces us to test the error path
async function getUser(id: string): ResultAsync<User, ApiError> {
  const response = await fetch(`/users/${id}`)
  if (!response.ok) return err({ type: 'api', message: 'User not found' }) // ← Branch!
  return ok(await response.json())
}
```

## Error Types

All errors use discriminated union types defined in `actions/shared/result.ts`:

```typescript
type GitHubError = { type: 'github'; status?: number; message: string }
type ValidationError = { type: 'validation'; field?: string; message: string }
type SDKError = { type: 'sdk'; subtype?: string; message: string }
type FileSystemError = {
  type: 'filesystem'
  code?: string
  path?: string
  message: string
}
type GitError = { type: 'git'; command?: string; message: string }
```

## Patterns

### Wrap external APIs at boundaries

```typescript
export function getIssue(
  octokit,
  owner,
  repo,
  number,
): ResultAsync<Issue, GitHubError> {
  return ResultAsync.fromPromise(
    octokit.issues.get({ owner, repo, issue_number: number }),
    toGitHubError,
  ).map((response) => response.data)
}
```

### Chain operations with `.andThen()` and `.map()`

```typescript
return getIssue(octokit, owner, repo, number)
  .andThen((issue) => validateIssue(issue)) // Returns Result
  .map((validIssue) => formatIssue(validIssue)) // Returns plain value
```

### Unwrap at entry points

```typescript
async function run(): Promise<void> {
  const result = await runWorkflow({...})

  if (result.isErr()) {
    logger.error({ error: result.error }, 'Workflow failed')
    core.setFailed(result.error.message)
    return
  }

  core.setOutput('output', result.value)
}
```

## Rules

1. **No `throw` in production code** - Use `err()` or `errAsync()` instead
2. **Entry points unwrap Results** - `actions/*/index.ts` files use `try/catch` for unexpected errors
3. **Always handle errors** - The `neverthrow/must-use-result` ESLint rule enforces this
4. **Test all error paths** - With Result types, coverage tools see error branches
