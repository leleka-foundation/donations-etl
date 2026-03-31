---
name: agentic-analytics
description: Build AI-powered natural language analytics using the Vercel AI SDK ToolLoopAgent pattern with BigQuery. Use this skill whenever the user wants to add a natural language query interface, NL2SQL, data Q&A bot, AI-powered reporting, or any feature where users ask questions about data in plain English and get answers from a database. Triggers on "ask questions about data", "natural language SQL", "AI query", "data assistant", "analytics bot", "chat with data", "query bot for a different table", "add a data source", "bad SQL", "hallucinated columns".
---

# Agentic Analytics: Natural Language → SQL → Formatted Answer

This skill implements the pattern where users ask questions in plain English and an AI agent
translates them to SQL, executes the queries, and formats the results.

## When to Use This

- Building a Q&A bot that answers data questions
- Adding natural language query capability to any data source
- Creating AI-powered dashboards or reports
- Adding a new table/data source to an existing query bot
- Troubleshooting SQL generation issues (hallucinated columns, bad queries)
- Any feature where users should be able to "chat with their data"

## Architecture: ToolLoopAgent with Query Tool

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

See `packages/bq/src/donation-agent.ts` for the complete implementation.

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

The system prompt is the most important piece — it determines SQL quality and output formatting.
It should include:

- **Table schema** with column names, types, and descriptions
- **Business rules** (e.g., "amounts are in cents, divide by 100 for dollars")
- **SQL dialect rules** (e.g., "use BigQuery SQL syntax")
- **Common mistakes to avoid** — explicitly list column names the LLM tends to hallucinate
  and their correct alternatives (e.g., "There is no `campaign` column. Use `attribution_human`.")
- **Formatting rules** for the output (Slack mrkdwn, HTML, plain text, etc.)
- **Few-shot examples** mapping questions to SQL (5-10 examples covering different query types)

If the bot hallucinates column names, the fix is almost always in the prompt — add negative
examples, improve descriptions, or add more few-shot examples. The self-correction loop helps
but burns tokens and latency; getting the prompt right is more efficient.

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

## Adding a New Data Source or Table

When adding a query agent for a different table (e.g., ETL run history, user accounts):

1. **Create a separate agent** with its own system prompt tailored to the new schema.
   Don't combine multiple schemas into one prompt — it confuses the LLM.

2. **Reuse the infrastructure**: `QueryFn` type, `buildQueryFn`, `sql-safety.ts` validation,
   and `BigQueryClient.executeReadOnlyQuery` are all reusable as-is.

3. **Use a distinct tool name** (e.g., `query_etl_runs` vs `query_bigquery`) to avoid
   confusion when multiple agents coexist.

4. **Route questions** to the right agent. Options:
   - Keyword-based routing (fast, zero LLM cost): regex patterns match question to agent
   - LLM-based routing (more flexible): a cheap classifier picks the agent
   - Single multi-tool agent (simplest for 2-3 sources): one agent with multiple query tools

## Multi-Source Queries (Cross-Database)

When users need to query across multiple databases (e.g., BigQuery + PostgreSQL):

Use a **multi-tool agent** — one ToolLoopAgent with separate query tools per database:

```typescript
tools: {
  query_bigquery: tool({ ... }),
  query_postgres: tool({ ... }),
}
```

The LLM orchestrates cross-source "joins" by querying one source, extracting linking values
(e.g., email addresses), then querying the other. This is simpler and safer than federated
SQL. Increase `MAX_STEPS` to 8-10 for multi-source queries.

The `sql-safety` module (`validateReadOnlySql`, `ensureLimit`) is dialect-agnostic and works
for both BigQuery and PostgreSQL.

## Testing with MockLanguageModelV3

Use the AI SDK's built-in test helpers — not manual mocks of the ai module:

```typescript
import { MockLanguageModelV3 } from 'ai/test'

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
called. Test self-correction by returning errors from the query function on the first call.
See `packages/bq/tests/donation-agent.test.ts` for complete examples including:

- Tool call flow-through
- Self-correction on query error
- Invalid tool input handling
- Multi-turn conversation history
- No-text response

## Model Selection

For SQL generation + formatting, use a fast, cheap model:

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
