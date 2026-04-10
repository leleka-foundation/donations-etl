/**
 * MCP tool: generate-letter
 *
 * Generates a donor confirmation letter by querying BigQuery for
 * donation history and rendering it as HTML or PDF.
 */
import {
  generateLetterHtml,
  generatePdf,
  processQueryResults,
  queryDonations,
  type LetterError,
} from '@donations-etl/letter'
import { ResultAsync, errAsync } from 'neverthrow'
import type { Logger } from 'pino'
import type { Config } from '../config'

/**
 * Dependencies injected into the tool handler for testability.
 */
export interface GenerateLetterDeps {
  config: Config
  logger: Logger
}

/**
 * Input arguments for the generate-letter tool.
 */
export interface GenerateLetterArgs {
  emails: string[]
  from?: string
  to?: string
  format?: 'pdf' | 'html'
  signerName?: string
  signerTitle?: string
}

/**
 * Result from the generate-letter tool.
 */
export interface GenerateLetterResult {
  content: string
  format: 'pdf' | 'html'
  donorName: string
}

/**
 * Handle a generate-letter tool call.
 *
 * Queries donations, processes results into letter data, and renders
 * as HTML or PDF. Returns base64-encoded PDF or raw HTML.
 */
export function handleGenerateLetter(
  args: GenerateLetterArgs,
  deps: GenerateLetterDeps,
): ResultAsync<GenerateLetterResult, LetterError> {
  const { config, logger } = deps
  const format = args.format ?? 'pdf'

  logger.info(
    { emails: args.emails.length, format },
    'generate-letter tool called',
  )

  return queryDonations(
    { projectId: config.PROJECT_ID, dataset: config.DATASET_CANON },
    args.emails,
    args.from,
    args.to,
  ).andThen((rows) => {
    if (rows.length === 0) {
      return errAsync({
        type: 'query' as const,
        message: 'No donations found for the given email(s)',
      })
    }

    const letterData = processQueryResults(rows, {
      signerName: args.signerName ?? config.DEFAULT_SIGNER_NAME,
      signerTitle: args.signerTitle ?? config.DEFAULT_SIGNER_TITLE,
      orgName: config.ORG_NAME,
      orgAddress: config.ORG_ADDRESS,
      orgMission: config.ORG_MISSION,
      orgTaxStatus: config.ORG_TAX_STATUS,
    })

    const htmlPromise = generateLetterHtml(letterData)

    if (format === 'html') {
      return ResultAsync.fromPromise(htmlPromise, (err) => ({
        type: 'render' as const,
        message: `HTML generation failed: ${err instanceof Error ? err.message : String(err)}`,
      })).map((html) => ({
        content: html,
        format: 'html' as const,
        donorName: letterData.donorName,
      }))
    }

    return ResultAsync.fromPromise(htmlPromise, (err) => ({
      type: 'render' as const,
      message: `HTML generation failed: ${err instanceof Error ? err.message : String(err)}`,
    })).andThen((html) =>
      generatePdf(html).map((pdfBuffer) => ({
        content: pdfBuffer.toString('base64'),
        format: 'pdf' as const,
        donorName: letterData.donorName,
      })),
    )
  })
}
