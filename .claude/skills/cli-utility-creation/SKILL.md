---
name: cli-utility-creation
description: Use when creating or updating command-line utilities, CLI tools, or scripts that parse command-line arguments. Guides through the standard pattern using commander and Zod for type-safe CLI utilities.
---

# Creating Command-Line Utilities

This skill guides you through creating or updating command-line utilities following Studio's standard pattern.

## When to Use This Skill

Use this pattern when:

- Creating a new script in `scripts/` that accepts command-line arguments
- Updating an existing CLI utility to follow modern patterns
- Building any tool that parses `process.argv`
- Adding CLI interfaces to TypeScript modules

**Note**: If a script has no command-line arguments (e.g., `check-coverage-thresholds.ts`), this pattern is not required.

## The Standard Pattern

All CLI utilities must follow this three-step pattern:

1. **Parse with Commander** - Use `commander` to parse command-line arguments
2. **Validate with Zod** - Validate the parsed result with Zod schemas
3. **Execute with Type Safety** - Work with validated, type-safe data

This ensures consistency, type safety, and maintainability across all CLI utilities.

## Complete Example

```typescript
import { Command } from 'commander'
import { z } from 'zod'

// Step 1: Define Zod schema for CLI options
const OptionsSchema = z.object({
  version: z.string().min(1, 'Version is required'),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
})

// Step 2: Infer TypeScript type from schema
type Options = z.infer<typeof OptionsSchema>

// Step 3: Parse arguments with commander
export function parseArgs(args: string[]): Options {
  const program = new Command()
    .name('release')
    .description('Create a new release')
    .argument(
      '<version>',
      'Version bump (major|minor|patch) or explicit version (1.2.3)',
    )
    .option('--dry-run', 'Show what would happen without making changes')
    .option('--force', 'Skip confirmation prompts')

  // Parse the arguments
  program.parse(args, { from: 'user' })

  // Step 4: Validate with Zod
  const options = OptionsSchema.parse({
    version: program.args[0],
    dryRun: program.opts().dryRun ?? false,
    force: program.opts().force ?? false,
  })

  return options
}

// Step 5: Main function with type-safe options
export async function main(args: string[]): Promise<void> {
  const options = parseArgs(args)

  // options is now type-safe: Options = { version: string, dryRun: boolean, force: boolean }

  if (options.dryRun) {
    console.log('Dry run mode - no changes will be made')
  }

  // Implement your business logic here...
  await createRelease(options)
}

// Step 6: Entrypoint with error handling
if (import.meta.main || process.env.STUDIO_SCRIPT_RUN_MAIN === 'true') {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

## Key Components

### 1. Zod Schema Definition

Define the schema FIRST, before any commander code:

```typescript
const OptionsSchema = z.object({
  // Required string
  input: z.string(),

  // Optional with default
  output: z.string().default('dist'),

  // Boolean flag
  verbose: z.boolean().default(false),

  // Number with validation
  count: z.number().int().positive(),

  // Enum for limited choices
  level: z.enum(['debug', 'info', 'warn', 'error']),
})

type Options = z.infer<typeof OptionsSchema>
```

### 2. Commander Parsing

Use commander to parse arguments and options:

```typescript
const program = new Command()
  .name('my-tool')
  .description('Description of what this tool does')
  .argument('<required>', 'Required argument description')
  .argument('[optional]', 'Optional argument description')
  .option('-v, --verbose', 'Enable verbose output')
  .option('-o, --output <path>', 'Output directory')

program.parse(args, { from: 'user' })
```

### 3. Validation Bridge

Connect commander to Zod validation:

```typescript
const options = OptionsSchema.parse({
  required: program.args[0],
  optional: program.args[1],
  verbose: program.opts().verbose ?? false,
  output: program.opts().output,
})
```

### 4. Main Function Signature

Always use this exact signature:

```typescript
export async function main(args: string[]): Promise<void> {
  const options = parseArgs(args)
  // Business logic here
}
```

Why this signature?

- **Testable**: Can pass custom args in tests
- **Consistent**: Same pattern across all CLI utilities
- **Flexible**: Works with `process.argv.slice(2)` in production

### 5. Entrypoint Guard

Use this pattern for the entrypoint:

```typescript
if (import.meta.main || process.env.STUDIO_SCRIPT_RUN_MAIN === 'true') {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

Why this guard?

- `import.meta.main`: True when run directly (Bun runtime)
- `process.env.STUDIO_SCRIPT_RUN_MAIN`: Allows tests to control execution
- Error handling: Logs errors and exits with non-zero code

## Testing CLI Utilities

### Exports for Testing

```typescript
// Export parseArgs for unit testing
export function parseArgs(args: string[]): Options { ... }

// Export main for integration testing
export async function main(args: string[]): Promise<void> { ... }
```

### Test Examples

```typescript
import { describe, it, expect } from 'vitest'
import { parseArgs, main } from './my-tool.ts'

describe('parseArgs', () => {
  it('should parse required arguments', () => {
    const options = parseArgs(['my-version', '--dry-run'])
    expect(options.version).toBe('my-version')
    expect(options.dryRun).toBe(true)
  })

  it('should apply defaults', () => {
    const options = parseArgs(['my-version'])
    expect(options.dryRun).toBe(false)
  })

  it('should throw on invalid arguments', () => {
    expect(() => parseArgs([])).toThrow()
  })
})

describe('main', () => {
  it('should execute without errors', async () => {
    await expect(main(['my-version'])).resolves.toBeUndefined()
  })
})
```

### Test Coverage

Achieve 100% test coverage (see `.claude/rules/testing.md`):

- Test all valid argument combinations
- Test all error conditions
- Test default value application
- Test type validation (Zod)

## Commander Documentation

Commander v14.0.2 is installed. Key features:

- `.argument('<name>')` - Required positional argument
- `.argument('[name]')` - Optional positional argument
- `.option('-f, --flag')` - Boolean flag
- `.option('-o, --option <value>')` - Option with required value
- `.option('-o, --option [value]')` - Option with optional value
- `.action((args, opts) => {...})` - Command handler (alternative pattern)

**Always search for current documentation** instead of relying on training data:

- Official repository: https://github.com/tj/commander.js
- See `.claude/rules/dependencies.md` for more guidance

## Common Patterns

### Subcommands

```typescript
const program = new Command()

program
  .command('init')
  .description('Initialize a new project')
  .action(() => { ... })

program
  .command('build')
  .description('Build the project')
  .option('--watch', 'Watch for changes')
  .action((opts) => { ... })
```

### Variadic Arguments

```typescript
program.argument('<files...>', 'Input files')

// Access via program.args (array)
const files = program.args // string[]
```

### Custom Validation

```typescript
const OptionsSchema = z.object({
  version: z
    .string()
    .refine(
      (v) => /^\d+\.\d+\.\d+$/.test(v),
      'Version must be in format X.Y.Z',
    ),
})
```

## Related Rules

- `.claude/rules/cli-parsing.md` - Requirement to use commander
- `.claude/rules/external-data-validation.md` - Requirement to validate with Zod
- `.claude/rules/typescript.md` - Type safety requirements
- `.claude/rules/testing.md` - 100% test coverage requirement

## Migration from Manual Parsing

If you encounter an existing script with manual `process.argv` parsing:

1. Create the Zod schema for the expected options
2. Replace manual parsing with commander
3. Add Zod validation bridge
4. Extract business logic into `main(args)`
5. Update tests to use new `parseArgs()` function
6. Achieve 100% test coverage

Example of manual parsing to replace:

```typescript
// ❌ OLD PATTERN - Do not use
const args = process.argv.slice(2)
let dryRun = false
let version = ''

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') {
    dryRun = true
  } else if (!args[i].startsWith('--')) {
    version = args[i]
  }
}

// ✅ NEW PATTERN - Use commander + Zod (see example above)
```

## Quick Start Checklist

When creating a new CLI utility:

- [ ] Define Zod schema for options
- [ ] Infer TypeScript type with `z.infer`
- [ ] Create `parseArgs(args: string[])` function
- [ ] Use commander to parse arguments
- [ ] Validate with Zod schema
- [ ] Create `main(args: string[])` function
- [ ] Add entrypoint guard with error handling
- [ ] Export `parseArgs` and `main` for testing
- [ ] Write tests achieving 100% coverage
- [ ] Verify `--help` output is clear

## Error Handling

Let Zod and commander errors bubble up naturally:

```typescript
export function parseArgs(args: string[]): Options {
  const program = new Command().argument('<version>', 'Version').exitOverride() // Throws instead of process.exit in tests

  try {
    program.parse(args, { from: 'user' })
  } catch (err) {
    // Commander parse error (e.g., unknown option)
    throw new Error(`Invalid arguments: ${err.message}`)
  }

  // Zod will throw ZodError if validation fails
  return OptionsSchema.parse({
    version: program.args[0],
  })
}
```

In tests, use `.exitOverride()` to make commander throw instead of calling `process.exit`.

---

**Remember**: This pattern ensures consistency, type safety, and testability across all CLI utilities in the codebase. Follow it for all new utilities and migrate existing ones when updating them.
