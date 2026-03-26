/**
 * PDF generation module.
 *
 * Uses Playwright Chromium to convert HTML to PDF.
 * Browser instance is launched once and reused across requests.
 */
import { ResultAsync } from 'neverthrow'
import type { Browser } from 'playwright'
import { type LetterError, createLetterError } from './types'

let browserInstance: Browser | null = null

/**
 * Launch the Chromium browser instance.
 *
 * Should be called once at server startup. The browser is reused
 * across all PDF generation requests.
 */
export function launchBrowser(): ResultAsync<Browser, LetterError> {
  return ResultAsync.fromPromise(
    (async () => {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH ?? undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      browserInstance = browser
      return browser
    })(),
    (error) =>
      createLetterError(
        'pdf',
        `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
  )
}

/**
 * Close the browser instance.
 *
 * Should be called at server shutdown.
 */
export function closeBrowser(): ResultAsync<void, LetterError> {
  if (!browserInstance) {
    return ResultAsync.fromSafePromise(Promise.resolve(undefined))
  }

  const browser = browserInstance
  browserInstance = null

  return ResultAsync.fromPromise(browser.close(), (error) =>
    createLetterError(
      'pdf',
      `Failed to close browser: ${error instanceof Error ? error.message : String(error)}`,
      error,
    ),
  )
}

/**
 * Generate a PDF from HTML content.
 *
 * Uses the shared browser instance to create a new page,
 * render the HTML, and produce a Letter-format PDF.
 */
export function generatePdf(html: string): ResultAsync<Buffer, LetterError> {
  if (!browserInstance) {
    return ResultAsync.fromPromise(
      Promise.reject(new Error('Browser not launched')),
      () =>
        createLetterError(
          'pdf',
          'Browser not launched. Call launchBrowser() first.',
        ),
    )
  }

  const browser = browserInstance

  return ResultAsync.fromPromise(
    (async () => {
      const page = await browser.newPage()
      try {
        await page.setContent(html, { waitUntil: 'networkidle' })
        const pdf = await page.pdf({
          format: 'Letter',
          printBackground: true,
          margin: {
            top: '0.75in',
            bottom: '0.75in',
            left: '1in',
            right: '1in',
          },
        })
        return Buffer.from(pdf)
      } finally {
        await page.close()
      }
    })(),
    (error) =>
      createLetterError(
        'pdf',
        `Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
  )
}
