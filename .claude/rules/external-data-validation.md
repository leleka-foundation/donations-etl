# External Data Validation Requirements

## All External Data Must Be Validated with Zod

**Every piece of external data entering this system must be validated using Zod schemas without exception.**

External data must NEVER be used directly without validation. All external data must be parsed through Zod schemas that produce well-defined TypeScript types.

### What is External Data?

External data includes ANY data that originates outside the application's trusted codebase:

- **API responses** - Data from REST APIs, GraphQL endpoints, webhooks
- **File contents** - JSON files, YAML files, text files, configuration files
- **Environment variables** - Values from `process.env`
- **User input** - Interactive prompts, form submissions, stdin
- **Command-line arguments** - Parsed CLI options and arguments (even after `commander` parsing)
- **Database query results** - Rows and columns from database queries
- **Third-party library outputs** - Responses from external SDKs or packages

### Required Pattern

```typescript
import { z } from 'zod'

// 1. Define Zod schema
const DataSchema = z.object({
  name: z.string(),
  count: z.number().int().positive(),
  optional: z.string().optional(),
})

// 2. Infer TypeScript type from schema
type Data = z.infer<typeof DataSchema>

// 3. Parse external data
const validated: Data = DataSchema.parse(externalData)

// 4. Use validated, type-safe data
processData(validated)
```

### Forbidden Patterns

1. **No unvalidated external data** - Do not use data from external sources without Zod validation:

   ```typescript
   // ❌ FORBIDDEN
   const config = JSON.parse(fileContents)
   const name = config.name // Unsafe! Could be undefined or wrong type

   // ✅ REQUIRED
   const config = ConfigSchema.parse(JSON.parse(fileContents))
   const name = config.name // Type-safe!
   ```

2. **No type assertions** - Do not use `as` to cast external data:

   ```typescript
   // ❌ FORBIDDEN
   const response = await fetch(url)
   const data = (await response.json()) as MyType

   // ✅ REQUIRED
   const response = await fetch(url)
   const data = MyTypeSchema.parse(await response.json())
   ```

3. **No trust in external types** - Even if a library claims to return a specific type, validate it:

   ```typescript
   // ❌ FORBIDDEN - trusting library's type
   const result = externalLibrary.getData() // Returns 'Promise<Data>'

   // ✅ REQUIRED - validate even library outputs
   const result = DataSchema.parse(await externalLibrary.getData())
   ```

### Why Zod for External Data?

- **Runtime safety**: Catches malformed data before it causes errors
- **Type safety**: Automatically narrows TypeScript types after validation
- **Clear errors**: Provides detailed error messages for debugging
- **Schema as documentation**: Zod schemas document the expected data structure
- **Transformations**: Can coerce and transform data during validation

### Examples in This Codebase

See `scripts/release.ts` for a good example:

```typescript
const PackageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  // ... more fields
})

const packageJson = PackageJsonSchema.parse(
  JSON.parse(await readFile('package.json', 'utf-8')),
)
```

### Integration with CLI Parsing

Command-line arguments are external data. Even after parsing with `commander`, validate the result with Zod:

```typescript
// 1. Parse with commander
program.parse(args, { from: 'user' })

// 2. Validate with Zod
const options = OptionsSchema.parse({
  version: program.args[0],
  dryRun: program.opts().dryRun,
})

// 3. Type-safe options
console.log(options.version) // string (validated)
```

See `.claude/rules/cli-parsing.md` for the complete CLI pattern.

### Documentation

Zod v4.2.1 is installed in this project. Always check current documentation:

- LLM-optimized docs: https://zod.dev/llms.txt
- Official website: https://zod.dev/

Remember to search for documentation (see `.claude/rules/dependencies.md`) rather than relying on training data.

### Performance Note

Zod parsing has minimal overhead. The safety and type guarantees far outweigh any performance cost. If you have a genuine performance concern with a specific schema, profile first and optimize second.
