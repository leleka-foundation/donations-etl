/**
 * LLM-powered formatting of query results for Slack.
 *
 * Uses the same Vertex AI model as NL2SQL to generate
 * well-formatted Slack mrkdwn from raw query results.
 */
import { createVertex } from '@ai-sdk/google-vertex'
import { generateText } from 'ai'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { BigQueryConfig } from './types'

/**
 * Error type for formatting.
 */
export interface FormatError {
  type: 'format'
  message: string
}

/**
 * Default model for formatting (same as SQL generation).
 */
const FORMAT_MODEL = 'gemini-2.5-flash'

/**
 * Build the system prompt for result formatting.
 */
function buildFormatPrompt(): string {
  return `You format donation query results for display in Slack.

## Your Task

Given a question, an explanation of the query, and the raw data rows, produce a well-formatted
Slack message using mrkdwn syntax.

## Slack mrkdwn Syntax

- *bold* for emphasis
- _italic_ for notes
- \`code\` for inline values
- \`\`\`code block\`\`\` for tables (monospace)
- > blockquote for callouts
- Bullet lists with •
- Emoji: :chart_with_upwards_trend: :moneybag: :tada: :warning: :busts_in_silhouette:

## Formatting Rules

1. *Lead with the answer.* Start with the most important number or insight, big and bold.
2. *Format money as whole dollars* with $ and commas (e.g., $15,000). No cents.
3. *Format counts* with commas (e.g., 1,234 donations).
4. *Choose the right layout* based on the data:
   - Single aggregate (1 row, 1-3 values): Big bold headline number with context
   - Small table (2-10 rows): Use a code block with aligned columns
   - Large table (10+ rows): Show top 10 in a code block, note how many more
   - Comparison/ranking: Use numbered list or code block with visual bar indicators
   - Time series: Use a code block table with periods as rows
5. *Add context* — a brief sentence explaining what the numbers mean.
6. *Keep it concise* — no filler, no restating the question.
7. *Use emoji sparingly* — one or two at most for visual accent.
8. When showing a table in a code block, align columns neatly. Right-align numbers, left-align text.
9. If data has a "donor" or "name" column, truncate long names to ~20 chars.
10. Do NOT include the SQL query — that's shown separately.

## Output

Return ONLY the formatted Slack mrkdwn text. No wrapping, no JSON, no explanation of your formatting choices.`
}

/**
 * Format query results using an LLM for rich Slack presentation.
 */
export function formatResultsWithLlm(
  question: string,
  explanation: string,
  rows: Record<string, unknown>[],
  config: BigQueryConfig,
): ResultAsync<string, FormatError> {
  const vertex = createVertex({
    project: config.projectId,
    location: 'us-central1',
  })

  // Truncate rows for the prompt to avoid token limits
  const displayRows = rows.slice(0, 50)
  const truncated = rows.length > 50

  const prompt = [
    `Question: "${question}"`,
    `Explanation: ${explanation}`,
    `Data (${rows.length} row${rows.length === 1 ? '' : 's'}${truncated ? ', showing first 50' : ''}):`,
    JSON.stringify(displayRows, null, 2),
  ].join('\n\n')

  return ResultAsync.fromPromise(
    generateText({
      model: vertex(FORMAT_MODEL),
      system: buildFormatPrompt(),
      prompt,
    }),
    (error) => ({
      type: 'format' as const,
      message: `Failed to format results: ${error instanceof Error ? error.message : String(error)}`,
    }),
  ).andThen((result) => {
    if (!result.text) {
      return errAsync({
        type: 'format' as const,
        message: 'Model returned no text',
      })
    }
    return okAsync(result.text)
  })
}
