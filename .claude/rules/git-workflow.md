# Git Workflow

## Branch Rules

- NEVER commit directly to main
- ALWAYS create feature branches: `git checkout -b feature/description`
- Give user a chance to review changes before committing
- Use descriptive commit messages

## Environment Variables

- Both `.env` and `.env.local` are loaded (`.env.local` takes precedence)
- `.env.local` is gitignored for local overrides
- Tests use `.env.test` and `.env.test.local` files
