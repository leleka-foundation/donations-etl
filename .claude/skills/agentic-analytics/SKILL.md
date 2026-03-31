---
name: agentic-analytics
description: Build AI-powered natural language analytics using the Vercel AI SDK ToolLoopAgent pattern with BigQuery. Use this skill whenever the user wants to add a natural language query interface, NL2SQL, data Q&A bot, AI-powered reporting, or any feature where users ask questions about data in plain English and get answers from a database. Triggers on "ask questions about data", "natural language SQL", "AI query", "data assistant", "analytics bot", "chat with data".
---

# Agentic Analytics: Natural Language → SQL → Formatted Answer

This skill implements the pattern where users ask questions in plain English and an AI agent
translates them to SQL, executes the queries, and formats the results.

## When to Use This

- Building a Q&A bot that answers data questions
- Adding natural language query capability to any data source
- Creating AI-powered dashboards or reports
- Any feature where users should be able to "chat with their data"

## Architecture: ToolLoopAgent with Query Tool

The core pattern uses the Vercel AI SDK's `ToolLoopAgent`:

```
User question
  → ToolLoopAgent (LLM + query tool)
    → LLM generates SQL
    → Tool executes SQL against database
    → LLM sees results
    → LLM formats a human-readable answer
    → (If query fails, LLM sees error and retries with fixed SQL)
  → Final text answer + SQL for transparency
```

This is better than a linear pipeline (generate SQL → execute → format) because:

1. **Self-correction** — if the SQL fails, the agent sees the error and retries
2. **Single LLM call** — generates SQL and formats results in one loop
3. **Multi-query** — can run multiple queries to fully answer complex questions

## Reference Implementation

See `packages/bq/src/donation-agent.ts` for the complete implementation:

- `createDonationAgent()` — creates the ToolLoopAgent with a query tool
- `buildQueryFn()` — wraps BigQuery execution with SQL safety validation
- `buildAgentPrompt()` — comprehensive system prompt with schema + rules + formatting
- `runDonationAgent()` — runs the agent and extracts results

## Key Components

### 1. The Agent (ToolLoopAgent)

```typescript
import { ToolLoopAgent, tool, stepCountIs } from 'ai'
import { createVertex } from '@ai-sdk/google-vertex'

const agent = new ToolLoopAgent({
  model: vertex('gemini-2.5-flash'),
  instructions: systemPrompt, // Schema + rules + formatting instructions
  tools: {
    query_database: tool({
      description: 'Execute a read-only SQL query',
      inputSchema: z.object({ sql: z.string() }),
      execute: async ({ sql }) => queryFn(sql),
    }),
  },
  stopWhen: stepCountIs(6), // Prevent infinite loops
})
```

### 2. The System Prompt

The system prompt is the most important piece. It should include:

- **Table schema** with column names, types, and descriptions
- **Business rules** (e.g., "amounts are in cents, divide by 100 for dollars")
- **SQL dialect rules** (e.g., "use BigQuery SQL syntax")
- **Formatting rules** for the output (Slack mrkdwn, HTML, plain text, etc.)
- **Few-shot examples** mapping questions to SQL (5-10 examples)

See `buildAgentPrompt()` in `donation-agent.ts` for a complete example.

### 3. The Query Tool

The tool wraps database execution with safety layers:

```typescript
export function buildQueryFn(executeQuery): QueryFn {
  return async (sql) => {
    // 1. Validate: must be SELECT/WITH, no DDL/DML keywords
    const error = validateReadOnlySql(sql)
    if (error) return { ok: false, error }

    // 2. Add LIMIT if missing
    const limited = ensureLimit(sql)

    // 3. Execute with byte billing cap
    const result = await executeQuery(limited)

    // 4. Return rows (capped) or error
    if (result.isErr()) return { ok: false, error: result.error.message }
    return {
      ok: true,
      rows: result.value.slice(0, 50),
      totalRows: result.value.length,
    }
  }
}
```

### 4. SQL Safety (Defense in Depth)

Three layers of protection:

1. **SQL validation** — reject non-SELECT statements, check for forbidden DDL/DML keywords
   outside string literals. See `packages/bq/src/sql-safety.ts`.

2. **Read-only service account** — the database credentials used by the bot should have
   only read permissions. Even if the agent generates malicious SQL, the database rejects it.

3. **Cost controls** — `maximumBytesBilled` caps query cost, auto-injected `LIMIT` prevents
   runaway result sets.

### 5. Multi-Turn Conversation

For follow-up questions, pass conversation history as messages:

```typescript
const generateArgs =
  history.length > 0
    ? { messages: [...history, { role: 'user', content: question }] }
    : { prompt: question }

const result = await agent.generate(generateArgs)
```

The agent sees previous questions and answers and can build on them
(e.g., "break that down by source" after "how much did we raise?").

### 6. Result Extraction

After the agent runs, extract the SQL it executed for transparency:

```typescript
const allToolCalls = result.steps.flatMap((step) => step.toolCalls)
const lastQueryCall = allToolCalls.findLast(
  (tc) => tc.toolName === 'query_database',
)
const sql = z.object({ sql: z.string() }).safeParse(lastQueryCall?.input)
```

## Testing with MockLanguageModelV3

Use the AI SDK's built-in test helpers — not manual mocks:

```typescript
import { MockLanguageModelV3 } from 'ai/test'

// Simulate: tool call → text response
let callCount = 0
const mockModel = new MockLanguageModelV3({
  doGenerate: async () => {
    callCount++
    if (callCount === 1) {
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: '1',
            toolName: 'query_database',
            input: JSON.stringify({ sql: 'SELECT 1' }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      }
    }
    return {
      content: [{ type: 'text', text: 'The answer is 1' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    }
  },
})
```

The real `ToolLoopAgent` runs with the mock model, and the tool's `execute` is actually
called. See `packages/bq/tests/donation-agent.test.ts` for complete examples.

## Model Selection

For SQL generation + formatting, use a fast, cheap model. The schema is fixed and the task
is well-defined — you don't need a frontier model.

- **Google Gemini 2.5 Flash** ($0.15/$0.60 per 1M tokens) — current default, fast
- **Claude Haiku 4.5** ($1/$5 per 1M tokens) — good alternative
- **GPT-4o-mini** — also works well for SQL generation

Use the `@ai-sdk/google-vertex` provider for GCP-native auth (Application Default Credentials,
same as BigQuery). No separate API key needed.

## File References

| File                                       | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| `packages/bq/src/donation-agent.ts`        | ToolLoopAgent, system prompt, query function |
| `packages/bq/src/sql-safety.ts`            | SQL validation and LIMIT injection           |
| `packages/bq/src/client.ts`                | `executeReadOnlyQuery` method                |
| `packages/bq/tests/donation-agent.test.ts` | Tests using MockLanguageModelV3              |
| `infra/provision.sh`                       | Read-only service account setup              |

## Adapting to Other Data Sources

This pattern is not BigQuery-specific. To adapt:

1. Replace the system prompt's schema section with your table(s)
2. Replace `executeReadOnlyQuery` with your database client
3. Adjust SQL dialect rules in the prompt (PostgreSQL, MySQL, etc.)
4. Keep the safety layers (validation, read-only user, LIMIT injection)
