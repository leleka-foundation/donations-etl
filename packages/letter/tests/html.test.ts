/**
 * Tests for the HTML letter generation module.
 */
import { describe, expect, it } from 'vitest'
import {
  formatAmount,
  generateLetterHtml,
  getCurrencySymbol,
  loadLogoBase64,
  processQueryResults,
  renderHtml,
} from '../src/html'
import type { DonationRow, LetterData } from '../src/types'

describe('getCurrencySymbol', () => {
  it('returns $ for USD', () => {
    expect(getCurrencySymbol('USD')).toBe('$')
  })

  it('returns € for EUR', () => {
    expect(getCurrencySymbol('EUR')).toBe('\u20AC')
  })

  it('returns £ for GBP', () => {
    expect(getCurrencySymbol('GBP')).toBe('\u00A3')
  })

  it('returns ₴ for UAH', () => {
    expect(getCurrencySymbol('UAH')).toBe('\u20B4')
  })

  it('returns CA$ for CAD', () => {
    expect(getCurrencySymbol('CAD')).toBe('CA$')
  })

  it('returns A$ for AUD', () => {
    expect(getCurrencySymbol('AUD')).toBe('A$')
  })

  it('returns currency code with space for unknown currencies', () => {
    expect(getCurrencySymbol('CHF')).toBe('CHF ')
  })
})

describe('formatAmount', () => {
  it('formats a whole dollar amount', () => {
    expect(formatAmount(100, 'USD')).toBe('$100.00')
  })

  it('formats cents correctly', () => {
    expect(formatAmount(49.99, 'USD')).toBe('$49.99')
  })

  it('formats with thousands separator', () => {
    expect(formatAmount(1234.56, 'USD')).toBe('$1,234.56')
  })

  it('formats euro amounts', () => {
    expect(formatAmount(500, 'EUR')).toBe('\u20AC500.00')
  })

  it('formats unknown currency', () => {
    expect(formatAmount(100, 'CHF')).toBe('CHF 100.00')
  })

  it('formats zero amount', () => {
    expect(formatAmount(0, 'USD')).toBe('$0.00')
  })
})

describe('processQueryResults', () => {
  const makeRow = (overrides: Partial<DonationRow> = {}): DonationRow => ({
    event_ts: { value: '2025-01-15T10:30:00Z' },
    amount: 100.0,
    currency: 'USD',
    source: 'paypal',
    status: 'succeeded',
    donor_name: 'Jane Doe',
    donor_email: 'jane@example.com',
    ...overrides,
  })

  it('extracts donor name from the most recent row', () => {
    const rows: DonationRow[] = [
      makeRow({ donor_name: 'Jane Smith' }),
      makeRow({
        event_ts: { value: '2025-06-01T00:00:00Z' },
        donor_name: 'Jane Doe',
      }),
    ]

    const data = processQueryResults(rows)

    expect(data.donorName).toBe('Jane Doe')
  })

  it('falls back to "Valued Donor" when all names are null', () => {
    const rows: DonationRow[] = [
      makeRow({ donor_name: null }),
      makeRow({ donor_name: null }),
    ]

    const data = processQueryResults(rows)

    expect(data.donorName).toBe('Valued Donor')
  })

  it('finds the most recent non-null name', () => {
    const rows: DonationRow[] = [
      makeRow({
        event_ts: { value: '2024-01-01T00:00:00Z' },
        donor_name: 'Old Name',
      }),
      makeRow({
        event_ts: { value: '2025-06-01T00:00:00Z' },
        donor_name: null,
      }),
    ]

    const data = processQueryResults(rows)

    // Last row has null, so it picks the first non-null from reversed
    expect(data.donorName).toBe('Old Name')
  })

  it('formats dates correctly', () => {
    const rows: DonationRow[] = [
      makeRow({ event_ts: { value: '2025-01-15T10:30:00Z' } }),
    ]

    const data = processQueryResults(rows)

    expect(data.yearGroups[0]?.donations[0]?.date).toBe('January 15, 2025')
  })

  it('groups donations by year', () => {
    const rows: DonationRow[] = [
      makeRow({
        event_ts: { value: '2024-03-15T00:00:00Z' },
        amount: 100,
      }),
      makeRow({
        event_ts: { value: '2024-06-20T00:00:00Z' },
        amount: 200,
      }),
      makeRow({
        event_ts: { value: '2025-01-10T00:00:00Z' },
        amount: 300,
      }),
    ]

    const data = processQueryResults(rows)

    expect(data.yearGroups).toHaveLength(2)
    expect(data.yearGroups[0]?.year).toBe(2024)
    expect(data.yearGroups[0]?.donations).toHaveLength(2)
    expect(data.yearGroups[1]?.year).toBe(2025)
    expect(data.yearGroups[1]?.donations).toHaveLength(1)
  })

  it('computes per-year currency totals', () => {
    const rows: DonationRow[] = [
      makeRow({
        event_ts: { value: '2024-03-15T00:00:00Z' },
        amount: 100,
        currency: 'USD',
      }),
      makeRow({
        event_ts: { value: '2024-06-20T00:00:00Z' },
        amount: 200,
        currency: 'USD',
      }),
    ]

    const data = processQueryResults(rows)

    expect(data.yearGroups[0]?.totals).toEqual([
      { currency: 'USD', total: 300, count: 2 },
    ])
  })

  it('handles multi-currency totals', () => {
    const rows: DonationRow[] = [
      makeRow({ amount: 100, currency: 'USD' }),
      makeRow({
        event_ts: { value: '2025-02-01T00:00:00Z' },
        amount: 50,
        currency: 'EUR',
      }),
      makeRow({
        event_ts: { value: '2025-03-01T00:00:00Z' },
        amount: 75,
        currency: 'USD',
      }),
    ]

    const data = processQueryResults(rows)

    expect(data.grandTotals).toHaveLength(2)

    const eurTotal = data.grandTotals.find((t) => t.currency === 'EUR')
    const usdTotal = data.grandTotals.find((t) => t.currency === 'USD')

    expect(eurTotal).toEqual({ currency: 'EUR', total: 50, count: 1 })
    expect(usdTotal).toEqual({ currency: 'USD', total: 175, count: 2 })
  })

  it('sorts grand totals by currency code', () => {
    const rows: DonationRow[] = [
      makeRow({ amount: 100, currency: 'USD' }),
      makeRow({
        event_ts: { value: '2025-02-01T00:00:00Z' },
        amount: 50,
        currency: 'EUR',
      }),
    ]

    const data = processQueryResults(rows)

    expect(data.grandTotals[0]?.currency).toBe('EUR')
    expect(data.grandTotals[1]?.currency).toBe('USD')
  })

  it('assigns sequential index numbers', () => {
    const rows: DonationRow[] = [
      makeRow({ event_ts: { value: '2025-01-01T00:00:00Z' } }),
      makeRow({ event_ts: { value: '2025-02-01T00:00:00Z' } }),
      makeRow({ event_ts: { value: '2025-03-01T00:00:00Z' } }),
    ]

    const data = processQueryResults(rows)
    const allDonations = data.yearGroups.flatMap((g) => g.donations)

    expect(allDonations.map((d) => d.index)).toEqual([1, 2, 3])
  })

  it('computes total count', () => {
    const rows: DonationRow[] = [
      makeRow({ event_ts: { value: '2025-01-01T00:00:00Z' } }),
      makeRow({ event_ts: { value: '2025-02-01T00:00:00Z' } }),
    ]

    const data = processQueryResults(rows)

    expect(data.totalCount).toBe(2)
  })

  it('accepts a custom letter date', () => {
    const data = processQueryResults([makeRow()], {
      letterDate: 'March 16, 2026',
    })

    expect(data.date).toBe('March 16, 2026')
  })

  it('defaults date to current UTC date', () => {
    const data = processQueryResults([makeRow()])

    // Just check it's a non-empty string in expected format
    expect(data.date).toMatch(/^\w+ \d{1,2}, \d{4}$/)
  })

  it('rounds currency totals to 2 decimal places', () => {
    const rows: DonationRow[] = [
      makeRow({ amount: 33.33 }),
      makeRow({
        event_ts: { value: '2025-02-01T00:00:00Z' },
        amount: 33.33,
      }),
      makeRow({
        event_ts: { value: '2025-03-01T00:00:00Z' },
        amount: 33.34,
      }),
    ]

    const data = processQueryResults(rows)

    expect(data.grandTotals[0]?.total).toBe(100)
  })

  it('uses default signer name and title', () => {
    const data = processQueryResults([makeRow()])

    expect(data.signerName).toBe('Organization Leader')
    expect(data.signerTitle).toBe('Director')
  })

  it('accepts custom signer name and title', () => {
    const data = processQueryResults([makeRow()], {
      signerName: 'John Smith',
      signerTitle: 'Treasurer',
    })

    expect(data.signerName).toBe('John Smith')
    expect(data.signerTitle).toBe('Treasurer')
  })
})

describe('renderHtml', () => {
  const sampleData: LetterData = {
    donorName: 'Jane Doe',
    date: 'January 15, 2025',
    yearGroups: [
      {
        year: 2025,
        donations: [
          {
            index: 1,
            date: 'January 15, 2025',
            amount: 100,
            currency: 'USD',
            year: 2025,
          },
          {
            index: 2,
            date: 'March 20, 2025',
            amount: 250.5,
            currency: 'USD',
            year: 2025,
          },
        ],
        totals: [{ currency: 'USD', total: 350.5, count: 2 }],
      },
    ],
    grandTotals: [{ currency: 'USD', total: 350.5, count: 2 }],
    totalCount: 2,
    signerName: 'Organization Leader',
    signerTitle: 'Director',
    orgName: 'Your Organization',
    orgAddress: '',
    orgMission:
      'Our organization is dedicated to making a positive impact through charitable giving.',
    orgTaxStatus:
      'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.',
  }

  const logoDataUri = 'data:image/png;base64,dGVzdA=='

  it('includes the letterhead with logo', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain(`src="${logoDataUri}"`)
    expect(html).toContain('Your Organization')
  })

  it('hides the img tag when logo is empty', () => {
    const html = renderHtml(sampleData, '')

    expect(html).not.toContain('<img')
    expect(html).toContain('Your Organization')
  })

  it('renders org address in letterhead and footer when provided', () => {
    const dataWithAddress: LetterData = {
      ...sampleData,
      orgAddress: '123 Main St, Anytown, ST 12345',
    }

    const html = renderHtml(dataWithAddress, logoDataUri)

    expect(html).toContain('class="org-address"')
    expect(html).toContain('123 Main St, Anytown, ST 12345')
    expect(html).toContain('&middot; 123 Main St')
  })

  it('omits org address when empty', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).not.toContain('class="org-address"')
    expect(html).not.toContain('&middot;')
  })

  it('includes the date right-aligned', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('class="date"')
    expect(html).toContain('January 15, 2025')
  })

  it('includes the recipient name', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('class="recipient"')
    expect(html).toContain('Jane Doe')
  })

  it('includes the subject line', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('Re: Donation Confirmation Letter')
  })

  it('includes the greeting', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('Dear Jane Doe')
  })

  it('includes the about paragraph', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain(
      'Our organization is dedicated to making a positive impact through charitable giving.',
    )
  })

  it('renders the donation table with correct amounts', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('$100.00')
    expect(html).toContain('$250.50')
  })

  it('renders the total row', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('Total: 2 donations')
    expect(html).toContain('$350.50')
  })

  it('includes the confirmation paragraph', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('used exclusively')
    expect(html).toContain('charitable purposes')
  })

  it('includes 501(c)(3) status', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain(
      'This organization is a tax-exempt organization under Section 501(c)(3)',
    )
    expect(html).toContain('EIN is available upon request')
    expect(html).toContain('No goods or services were provided')
  })

  it('includes the signature block', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('With sincere gratitude')
    expect(html).toContain('Organization Leader')
    expect(html).toContain('Director')
  })

  it('renders custom signer name and title', () => {
    const customData: LetterData = {
      ...sampleData,
      signerName: 'John Smith',
      signerTitle: 'Treasurer',
    }

    const html = renderHtml(customData, logoDataUri)

    expect(html).toContain('John Smith')
    expect(html).toContain('Treasurer')
    expect(html).not.toContain('Organization Leader')
  })

  it('includes the footer', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('class="footer"')
    expect(html).toContain('Your Organization')
  })

  it('uses singular for single donation', () => {
    const singleData: LetterData = {
      ...sampleData,
      yearGroups: [
        {
          year: 2025,
          donations: [
            {
              index: 1,
              date: 'January 15, 2025',
              amount: 100,
              currency: 'USD',
              year: 2025,
            },
          ],
          totals: [{ currency: 'USD', total: 100, count: 1 }],
        },
      ],
      grandTotals: [{ currency: 'USD', total: 100, count: 1 }],
      totalCount: 1,
    }

    const html = renderHtml(singleData, logoDataUri)

    expect(html).toContain('your donation on record')
    expect(html).toContain('donation listed above')
    expect(html).toContain('was received')
    expect(html).toContain('this contribution')
    expect(html).toContain('Total: 1 donation<')
  })

  it('renders multi-year groups with year headers', () => {
    const multiYearData: LetterData = {
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [
        {
          year: 2024,
          donations: [
            {
              index: 1,
              date: 'March 15, 2024',
              amount: 100,
              currency: 'USD',
              year: 2024,
            },
          ],
          totals: [{ currency: 'USD', total: 100, count: 1 }],
        },
        {
          year: 2025,
          donations: [
            {
              index: 2,
              date: 'January 10, 2025',
              amount: 200,
              currency: 'USD',
              year: 2025,
            },
          ],
          totals: [{ currency: 'USD', total: 200, count: 1 }],
        },
      ],
      grandTotals: [{ currency: 'USD', total: 300, count: 2 }],
      totalCount: 2,
      signerName: 'Organization Leader',
      signerTitle: 'Director',
      orgName: 'Your Organization',
      orgAddress: '',
      orgMission:
        'Our organization is dedicated to making a positive impact through charitable giving.',
      orgTaxStatus:
        'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.',
    }

    const html = renderHtml(multiYearData, logoDataUri)

    expect(html).toContain('class="year-header"')
    expect(html).toContain('>2024<')
    expect(html).toContain('>2025<')
  })

  it('does not show year headers for single-year data', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).not.toContain('class="year-header"')
  })

  it('renders multi-currency donations with currency labels', () => {
    const multiCurrencyData: LetterData = {
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [
        {
          year: 2025,
          donations: [
            {
              index: 1,
              date: 'January 15, 2025',
              amount: 100,
              currency: 'USD',
              year: 2025,
            },
            {
              index: 2,
              date: 'February 1, 2025',
              amount: 50,
              currency: 'EUR',
              year: 2025,
            },
            {
              index: 3,
              date: 'March 1, 2025',
              amount: 75,
              currency: 'USD',
              year: 2025,
            },
          ],
          totals: [
            { currency: 'EUR', total: 50, count: 1 },
            { currency: 'USD', total: 175, count: 2 },
          ],
        },
      ],
      grandTotals: [
        { currency: 'EUR', total: 50, count: 1 },
        { currency: 'USD', total: 175, count: 2 },
      ],
      totalCount: 3,
      signerName: 'Organization Leader',
      signerTitle: 'Director',
      orgName: 'Your Organization',
      orgAddress: '',
      orgMission:
        'Our organization is dedicated to making a positive impact through charitable giving.',
      orgTaxStatus:
        'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.',
    }

    const html = renderHtml(multiCurrencyData, logoDataUri)

    expect(html).toContain('$100.00 USD')
    expect(html).toContain('\u20AC50.00 EUR')
    expect(html).toContain('Total (USD)')
    expect(html).toContain('Total (EUR)')
  })

  it('produces valid HTML document', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('</html>')
    expect(html).toContain('<meta charset="UTF-8">')
  })

  it('includes print-ready CSS', () => {
    const html = renderHtml(sampleData, logoDataUri)

    expect(html).toContain('@page')
    expect(html).toContain('size: letter')
    expect(html).toContain('font-family: Georgia')
  })

  it('renders empty grand totals gracefully', () => {
    const emptyData: LetterData = {
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [],
      grandTotals: [],
      totalCount: 0,
      signerName: 'Organization Leader',
      signerTitle: 'Director',
      orgName: 'Your Organization',
      orgAddress: '',
      orgMission:
        'Our organization is dedicated to making a positive impact through charitable giving.',
      orgTaxStatus:
        'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.',
    }

    const html = renderHtml(emptyData, logoDataUri)

    // Should still render without errors
    expect(html).toContain('Your Organization')
    expect(html).not.toContain('Total:')
  })
})

describe('loadLogoBase64', () => {
  it('returns a base64 data URI when a logo file exists', async () => {
    const { writeFile, unlink } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const tmpLogo = resolve(import.meta.dirname, '..', 'assets', 'logo.png')

    // Create a minimal 1x1 PNG
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
        'Nl7BcQAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(tmpLogo, pngBytes)

    try {
      const dataUri = await loadLogoBase64()
      expect(dataUri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]/)
    } finally {
      await unlink(tmpLogo)
    }
  })

  it('returns empty string when no logo file is found', async () => {
    const dataUri = await loadLogoBase64()

    expect(dataUri).toBe('')
  })

  it('returns consistent output on repeated calls', async () => {
    const first = await loadLogoBase64()
    const second = await loadLogoBase64()

    expect(first).toBe(second)
  })
})

describe('generateLetterHtml', () => {
  it('generates complete HTML with embedded logo', async () => {
    const data: LetterData = {
      donorName: 'Jane Doe',
      date: 'January 15, 2025',
      yearGroups: [
        {
          year: 2025,
          donations: [
            {
              index: 1,
              date: 'January 15, 2025',
              amount: 100,
              currency: 'USD',
              year: 2025,
            },
          ],
          totals: [{ currency: 'USD', total: 100, count: 1 }],
        },
      ],
      grandTotals: [{ currency: 'USD', total: 100, count: 1 }],
      totalCount: 1,
      signerName: 'Organization Leader',
      signerTitle: 'Director',
      orgName: 'Your Organization',
      orgAddress: '',
      orgMission:
        'Our organization is dedicated to making a positive impact through charitable giving.',
      orgTaxStatus:
        'This organization is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is available upon request.',
    }

    const html = await generateLetterHtml(data)

    // Logo file was removed, so loadLogoBase64 returns empty string
    expect(html).toContain('Jane Doe')
    expect(html).toContain('$100.00')
  })
})
