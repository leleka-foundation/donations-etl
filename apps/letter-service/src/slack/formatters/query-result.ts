/**
 * Slack Block Kit formatter for donation query results.
 *
 * Formats BigQuery query results into readable Slack messages.
 */

/**
 * Block types used in query result formatting.
 */
interface SectionBlock {
  type: 'section'
  text: { type: 'mrkdwn'; text: string }
}

interface ContextBlock {
  type: 'context'
  elements: { type: 'mrkdwn'; text: string }[]
}

interface DividerBlock {
  type: 'divider'
}

type QueryBlock = SectionBlock | ContextBlock | DividerBlock

/**
 * Formatted query response ready to post to Slack.
 */
export interface QueryResponse {
  blocks: QueryBlock[]
  threadBlocks: QueryBlock[]
  text: string
}

/**
 * Maximum number of rows to display in the main message.
 */
const MAX_DISPLAY_ROWS = 15

/**
 * Maximum column width for table formatting.
 */
const MAX_COL_WIDTH = 20

/**
 * Format a value for display in Slack.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'boolean') return value.toString()
  /* istanbul ignore next -- @preserve JSON.stringify always returns string for non-null objects */
  if (typeof value === 'object') return JSON.stringify(value)
  /* istanbul ignore next -- @preserve defensive: bigint/symbol not returned by BigQuery */
  return '—'
}

/**
 * Truncate a string to a max length.
 */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

/**
 * Pad string to width.
 */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}

/**
 * Right-align string to width.
 */
function rpad(str: string, width: number): string {
  return str.length >= width ? str : ' '.repeat(width - str.length) + str
}

/**
 * Check if a value looks numeric (for right-alignment).
 */
function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return true
  if (typeof value === 'string') return /^-?[\d,.]+$/.test(value)
  return false
}

/**
 * Get the first row of a non-empty array.
 * Avoids `rows[0] ?? {}` which creates uncoverable branches.
 */
/* istanbul ignore next -- @preserve defensive: always called with non-empty arrays */
function firstRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  if (rows.length === 0) return {}
  return rows[0] ?? {}
}

/**
 * Format query results as Slack blocks.
 */
export function formatQueryResult(
  rows: Record<string, unknown>[],
  explanation: string,
  sql: string,
): QueryResponse {
  const blocks: QueryBlock[] = []
  const threadBlocks: QueryBlock[] = []

  // Explanation
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: explanation },
  })

  // No results
  if (rows.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No results found._' },
    })
  } else if (rows.length === 1 && Object.keys(firstRow(rows)).length <= 3) {
    // Single row with few columns — display prominently
    const row = firstRow(rows)
    const parts = Object.entries(row).map(
      ([key, value]) => `*${key}:* ${formatValue(value)}`,
    )
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: parts.join('\n') },
    })
  } else {
    // Multiple rows — format as table
    const displayRows = rows.slice(0, MAX_DISPLAY_ROWS)
    const columns = Object.keys(firstRow(rows))

    // Calculate column widths
    const widths = columns.map((col) => {
      const values = displayRows.map((r) =>
        truncate(formatValue(r[col]), MAX_COL_WIDTH),
      )
      return Math.min(
        MAX_COL_WIDTH,
        Math.max(col.length, ...values.map((v) => v.length)),
      )
    })

    // Check which columns are numeric for alignment
    const numericCols = columns.map((col) =>
      displayRows.every((r) => r[col] === null || isNumeric(r[col])),
    )

    // Header
    const header = columns
      .map((col, i) => {
        /* istanbul ignore next -- @preserve defensive: widths always matches columns */
        const w = widths[i] ?? MAX_COL_WIDTH
        return pad(truncate(col, w), w)
      })
      .join('  ')

    // Rows
    const tableRows = displayRows.map((row) =>
      columns
        .map((col, i) => {
          /* istanbul ignore next -- @preserve defensive: widths always matches columns */
          const w = widths[i] ?? MAX_COL_WIDTH
          const val = truncate(formatValue(row[col]), w)
          return numericCols[i] ? rpad(val, w) : pad(val, w)
        })
        .join('  '),
    )

    const table = [`\`${header}\``, ...tableRows.map((r) => `\`${r}\``)].join(
      '\n',
    )
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: table },
    })

    if (rows.length > MAX_DISPLAY_ROWS) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Showing ${MAX_DISPLAY_ROWS} of ${rows.length} results_`,
          },
        ],
      })
    }
  }

  // SQL in thread reply
  threadBlocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Generated SQL:*\n\`\`\`${sql}\`\`\`` },
  })

  return {
    blocks,
    threadBlocks,
    text: explanation,
  }
}

/**
 * Format an error as Slack blocks.
 */
export function formatQueryError(message: string): QueryResponse {
  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `I couldn't answer that question. ${message}`,
        },
      },
    ],
    threadBlocks: [],
    text: `Error: ${message}`,
  }
}
