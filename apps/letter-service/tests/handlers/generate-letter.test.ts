/**
 * Tests for the generate-letter handler.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../src/config'
import { createTestLogger, parseJsonResponse } from '../test-utils'

// Mock @donations-etl/letter
const mockQueryDonations = vi.fn<
  (
    config: { projectId: string; dataset: string },
    emails: string[],
    from?: string,
    to?: string,
  ) => Promise<{
    isOk: () => boolean
    isErr: () => boolean
    value?: unknown[]
    error?: { message: string }
  }>
>()

const mockProcessQueryResults = vi.fn<
  (rows: unknown[]) => {
    donorName: string
    date: string
    yearGroups: unknown[]
    grandTotals: unknown[]
    totalCount: number
  }
>()

const mockGenerateLetterHtml = vi.fn<(data: unknown) => Promise<string>>()

const mockGeneratePdf = vi.fn<
  (html: string) => Promise<{
    isOk: () => boolean
    isErr: () => boolean
    value?: Buffer
    error?: { message: string }
  }>
>()

vi.mock('@donations-etl/letter', async () => {
  const { z } = await import('zod')
  const schema = z.object({
    emails: z.array(z.email()).min(1),
    from: z.string().optional(),
    to: z.string().optional(),
    format: z.enum(['pdf', 'html']).default('pdf'),
  })

  return {
    LetterRequestSchema: {
      safeParse: (data: unknown) => schema.safeParse(data),
    },
    queryDonations: (
      cfg: { projectId: string; dataset: string },
      emails: string[],
      from?: string,
      to?: string,
    ) => mockQueryDonations(cfg, emails, from, to),
    processQueryResults: (rows: unknown[]) => mockProcessQueryResults(rows),
    generateLetterHtml: (data: unknown) => mockGenerateLetterHtml(data),
    generatePdf: (html: string) => mockGeneratePdf(html),
  }
})

import { handleGenerateLetter } from '../../src/handlers/generate-letter'

const config: Config = {
  PORT: 8080,
  LOG_LEVEL: 'info',
  PROJECT_ID: 'test-project',
  DATASET_CANON: 'donations',
  LETTER_SERVICE_API_KEY: 'test-key',
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_SIGNING_SECRET: 'test-secret',
  ORG_NAME: 'Your Organization',
  ORG_ADDRESS: '',
  ORG_MISSION:
    'Our organization is dedicated to making a positive impact through charitable giving.',
  ORG_TAX_STATUS:
    'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.',
  DEFAULT_SIGNER_NAME: 'Organization Leader',
  DEFAULT_SIGNER_TITLE: 'Director',
}

const logger = createTestLogger()

describe('handleGenerateLetter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for invalid JSON body', async () => {
    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      body: 'not json',
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(400)
    const body = await parseJsonResponse(response)
    expect(body).toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 for missing emails', async () => {
    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(400)
    const body = await parseJsonResponse(response)
    expect(body.error).toBe('Invalid request')
  })

  it('returns 400 for invalid email', async () => {
    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['not-email'] }),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(400)
  })

  it('returns 500 when query fails', async () => {
    mockQueryDonations.mockResolvedValue({
      isOk: () => false,
      isErr: () => true,
      error: { message: 'Connection failed' },
    })

    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['jane@example.com'] }),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(500)
    const body = await parseJsonResponse(response)
    expect(body).toEqual({ error: 'Failed to query donations' })
  })

  it('returns 404 when no donations found', async () => {
    mockQueryDonations.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: [],
    })

    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['nobody@example.com'] }),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(404)
    const body = await parseJsonResponse(response)
    expect(body.error).toBe('No donations found for the given email(s)')
  })

  it('returns HTML when format is html', async () => {
    const mockRows = [{ some: 'data' }]
    mockQueryDonations.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: mockRows,
    })
    mockProcessQueryResults.mockReturnValue({
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [],
      grandTotals: [],
      totalCount: 1,
    })
    mockGenerateLetterHtml.mockResolvedValue('<html>letter</html>')

    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails: ['jane@example.com'],
        format: 'html',
      }),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    )
    const body = await response.text()
    expect(body).toBe('<html>letter</html>')
  })

  it('returns PDF by default', async () => {
    const mockRows = [{ some: 'data' }]
    const pdfBuffer = Buffer.from('fake-pdf')

    mockQueryDonations.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: mockRows,
    })
    mockProcessQueryResults.mockReturnValue({
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [],
      grandTotals: [],
      totalCount: 1,
    })
    mockGenerateLetterHtml.mockResolvedValue('<html>letter</html>')
    mockGeneratePdf.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: pdfBuffer,
    })

    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['jane@example.com'] }),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain(
      'jane-doe.pdf',
    )
  })

  it('returns 500 when PDF generation fails', async () => {
    const mockRows = [{ some: 'data' }]

    mockQueryDonations.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: mockRows,
    })
    mockProcessQueryResults.mockReturnValue({
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [],
      grandTotals: [],
      totalCount: 1,
    })
    mockGenerateLetterHtml.mockResolvedValue('<html>letter</html>')
    mockGeneratePdf.mockResolvedValue({
      isOk: () => false,
      isErr: () => true,
      error: { message: 'Browser crashed' },
    })

    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['jane@example.com'] }),
    })

    const response = await handleGenerateLetter(request, config, logger)

    expect(response.status).toBe(500)
    const body = await parseJsonResponse(response)
    expect(body).toEqual({ error: 'Failed to generate PDF' })
  })

  it('passes date filters to query', async () => {
    mockQueryDonations.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: [],
    })

    const request = new Request('http://localhost/api/generate-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails: ['jane@example.com'],
        from: '2024-01-01',
        to: '2024-12-31',
      }),
    })

    await handleGenerateLetter(request, config, logger)

    expect(mockQueryDonations).toHaveBeenCalledWith(
      { projectId: 'test-project', dataset: 'donations' },
      ['jane@example.com'],
      '2024-01-01',
      '2024-12-31',
    )
  })
})
