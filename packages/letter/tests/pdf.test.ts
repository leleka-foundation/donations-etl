/**
 * Tests for the PDF generation module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock playwright before importing
const mockPdf = vi.fn<() => Promise<Buffer>>()
const mockSetContent =
  vi.fn<(html: string, opts: { waitUntil: string }) => Promise<void>>()
const mockClose = vi.fn<() => Promise<void>>()
const mockNewPage = vi.fn<
  () => Promise<{
    setContent: typeof mockSetContent
    pdf: typeof mockPdf
    close: typeof mockClose
  }>
>()
const mockBrowserClose = vi.fn<() => Promise<void>>()
const mockLaunch = vi.fn<
  (opts: unknown) => Promise<{
    newPage: typeof mockNewPage
    close: typeof mockBrowserClose
  }>
>()

vi.mock('playwright', () => ({
  chromium: {
    launch: mockLaunch,
  },
}))

import { closeBrowser, generatePdf, launchBrowser } from '../src/pdf'

describe('launchBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the module's internal browser state by closing any existing browser
    // We need to reset between tests
  })

  it('launches chromium with sandbox disabled', async () => {
    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)

    const result = await launchBrowser()

    expect(result.isOk()).toBe(true)
    expect(mockLaunch).toHaveBeenCalledWith({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  })

  it('returns error when launch fails', async () => {
    mockLaunch.mockRejectedValue(new Error('No browser found'))

    const result = await launchBrowser()

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('pdf')
      expect(result.error.message).toContain('No browser found')
    }
  })

  it('handles non-Error thrown values', async () => {
    mockLaunch.mockRejectedValue('string error')

    const result = await launchBrowser()

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('string error')
    }
  })
})

describe('closeBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the browser instance', async () => {
    // First launch a browser to set the internal state
    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    mockBrowserClose.mockResolvedValue(undefined)

    await launchBrowser()

    const result = await closeBrowser()

    expect(result.isOk()).toBe(true)
    expect(mockBrowserClose).toHaveBeenCalled()
  })

  it('succeeds when no browser is launched', async () => {
    // Ensure browser is closed first
    mockBrowserClose.mockResolvedValue(undefined)
    await closeBrowser()

    const result = await closeBrowser()

    expect(result.isOk()).toBe(true)
  })

  it('returns error when browser close fails', async () => {
    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    mockBrowserClose.mockRejectedValue(new Error('Close failed'))

    const result = await closeBrowser()

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('pdf')
      expect(result.error.message).toContain('Close failed')
    }
  })

  it('handles non-Error thrown values on close', async () => {
    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    mockBrowserClose.mockRejectedValue('string close error')

    const result = await closeBrowser()

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('string close error')
    }
  })
})

describe('generatePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a PDF from HTML', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-content')
    mockPdf.mockResolvedValue(pdfBuffer)
    mockSetContent.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockClose,
    })

    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    const result = await generatePdf('<html>test</html>')

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(Buffer.isBuffer(result.value)).toBe(true)
    }
  })

  it('sets content with networkidle wait', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-content')
    mockPdf.mockResolvedValue(pdfBuffer)
    mockSetContent.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockClose,
    })

    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    await generatePdf('<html>test</html>')

    expect(mockSetContent).toHaveBeenCalledWith('<html>test</html>', {
      waitUntil: 'networkidle',
    })
  })

  it('uses Letter format with margins', async () => {
    const pdfBuffer = Buffer.from('fake-pdf-content')
    mockPdf.mockResolvedValue(pdfBuffer)
    mockSetContent.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockClose,
    })

    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    await generatePdf('<html>test</html>')

    expect(mockPdf).toHaveBeenCalledWith({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.75in',
        bottom: '0.75in',
        left: '1in',
        right: '1in',
      },
    })
  })

  it('closes page even if pdf generation fails', async () => {
    mockSetContent.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockPdf.mockRejectedValue(new Error('PDF error'))
    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockClose,
    })

    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    const result = await generatePdf('<html>test</html>')

    expect(result.isErr()).toBe(true)
    expect(mockClose).toHaveBeenCalled()
  })

  it('returns error when browser not launched', async () => {
    // Ensure no browser is active
    mockBrowserClose.mockResolvedValue(undefined)
    await closeBrowser()

    const result = await generatePdf('<html>test</html>')

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('pdf')
      expect(result.error.message).toContain('Browser not launched')
    }
  })

  it('returns error when page creation fails', async () => {
    mockNewPage.mockRejectedValue(new Error('Page creation failed'))

    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    const result = await generatePdf('<html>test</html>')

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('pdf')
      expect(result.error.message).toContain('Page creation failed')
    }
  })

  it('handles non-Error thrown values in PDF generation', async () => {
    mockNewPage.mockRejectedValue('string pdf error')

    const mockBrowser = {
      newPage: mockNewPage,
      close: mockBrowserClose,
    }
    mockLaunch.mockResolvedValue(mockBrowser)
    await launchBrowser()

    const result = await generatePdf('<html>test</html>')

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('string pdf error')
    }
  })
})
