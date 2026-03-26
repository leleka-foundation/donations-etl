# Command-Line Parsing Requirements

## All CLI Utilities Must Use Commander

**All command-line utilities in this project must use the `commander` library for parsing command-line arguments and options.**

This requirement applies to:

- All new CLI utilities and scripts
- Updates to existing CLI utilities
- Any code that parses `process.argv`

### Forbidden Patterns

1. **No manual `process.argv` parsing** - Do not manually iterate over `process.argv` or use array slicing to extract arguments. Use `commander` instead.

2. **No hand-rolled argument parsers** - Do not write custom functions that parse arguments with string manipulation, regex, or manual flag detection.

3. **No third-party CLI parsing libraries** - Use `commander` exclusively. Do not introduce alternative libraries like `yargs`, `minimist`, or `meow`.

### Required Pattern

```typescript
import { Command } from 'commander'

export function parseArgs(args: string[]): ParsedOptions {
  const program = new Command()
    .argument('<required>', 'Description')
    .option('--flag', 'Description')

  program.parse(args, { from: 'user' })

  // Validate with Zod (see external-data-validation.md)
  return OptionsSchema.parse({
    required: program.args[0],
    flag: program.opts().flag,
  })
}
```

### Why Commander?

- **Consistency**: One parsing library across all CLI utilities
- **Type safety**: Integrates cleanly with Zod validation
- **Automatic help**: Generates `--help` output automatically
- **Rich features**: Supports subcommands, variadic arguments, and custom parsing
- **Well-maintained**: Industry-standard library with strong ecosystem support

### Documentation

Commander v14.0.2 is installed in this project. Always check the current documentation:

- Official repository: https://github.com/tj/commander.js
- Remember to search for documentation (see `.claude/rules/dependencies.md`) rather than relying on training data

### Migration Note

Existing scripts that use manual `process.argv` parsing should be migrated to `commander` when they are updated. Migration of all existing utilities is not required immediately, but all new utilities must follow this standard.
