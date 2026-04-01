/**
 * Handler for POST /api/generate-letter.
 *
 * Generates a donor confirmation letter in PDF or HTML format.
 */
import {
  LetterRequestSchema,
  generateLetterHtml,
  generatePdf,
  processQueryResults,
  queryDonations,
} from '@donations-etl/letter'
import type { Logger } from 'pino'
import type { Config } from '../config'

/**
 * Handle a generate-letter API request.
 */
export async function handleGenerateLetter(
  request: Request,
  config: Config,
  logger: Logger,
): Promise<Response> {
  // Parse and validate request body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const parsed = LetterRequestSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse(400, {
      error: 'Invalid request',
      details: parsed.error.message,
    })
  }

  const { emails, from, to, format, signerName, signerTitle } = parsed.data

  logger.info({ emails: emails.length, format }, 'Generating letter')

  // Query BigQuery for donations
  const queryResult = await queryDonations(
    { projectId: config.PROJECT_ID, dataset: config.DATASET_CANON },
    emails,
    from,
    to,
  )

  if (queryResult.isErr()) {
    logger.error({ error: queryResult.error }, 'Query failed')
    return jsonResponse(500, { error: 'Failed to query donations' })
  }

  const rows = queryResult.value

  if (rows.length === 0) {
    return jsonResponse(404, {
      error: 'No donations found for the given email(s)',
    })
  }

  // Process results and generate HTML
  const letterData = processQueryResults(rows, {
    signerName,
    signerTitle,
    orgName: config.ORG_NAME,
    orgAddress: config.ORG_ADDRESS,
    orgMission: config.ORG_MISSION,
    orgTaxStatus: config.ORG_TAX_STATUS,
  })
  const html = await generateLetterHtml(letterData)

  if (format === 'html') {
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Generate PDF
  const pdfResult = await generatePdf(html)

  if (pdfResult.isErr()) {
    logger.error({ error: pdfResult.error }, 'PDF generation failed')
    return jsonResponse(500, { error: 'Failed to generate PDF' })
  }

  return new Response(pdfResult.value, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="donation-confirmation-${letterData.donorName.replace(/\s+/g, '-').toLowerCase()}.pdf"`,
    },
  })
}

/**
 * Create a JSON response.
 */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
