# Code Style

## Formatting and Tools

- Use Prettier for formatting (`bun format`)
- Use ESLint for linting (`bun lint`)
- Use luxon for date/time handling
- Use pino for logging
- Use Zod for runtime validation

## Key Commands

```bash
bun typecheck        # Run TypeScript type checking (ALWAYS run after changes)
bun build            # Build for production
bun lint             # Run ESLint
bun format           # Format code with Prettier
bun test             # Run tests in watch mode
bun test:run         # Run tests once
```

## Pre-commit Hooks

Pre-commit runs automatically via husky:

- typecheck
- lint
- format

## Principles

- Keep code simple and readable
- No over-engineering
- Delete unused code completely—no backwards-compatibility hacks
