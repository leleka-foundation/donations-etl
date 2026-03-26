/**
 * HTML letter generation module.
 *
 * Transforms BigQuery donation rows into a professional HTML confirmation letter.
 */
import { DateTime } from 'luxon'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_ORG_ADDRESS,
  DEFAULT_ORG_MISSION,
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_TAX_STATUS,
  DEFAULT_SIGNER_NAME,
  DEFAULT_SIGNER_TITLE,
  type CurrencyTotal,
  type DonationRow,
  type LetterData,
  type LetterDonation,
  type LetterOptions,
  type YearGroup,
} from './types'

/**
 * Currency symbols for common currencies.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '\u20AC',
  GBP: '\u00A3',
  UAH: '\u20B4',
  CAD: 'CA$',
  AUD: 'A$',
}

/**
 * Get the display symbol for a currency code.
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `
}

/**
 * Format a monetary amount with currency symbol.
 */
export function formatAmount(amount: number, currency: string): string {
  const symbol = getCurrencySymbol(currency)
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Process raw BigQuery donation rows into structured LetterData.
 */
export function processQueryResults(
  rows: DonationRow[],
  options?: LetterOptions,
): LetterData {
  const {
    letterDate,
    signerName,
    signerTitle,
    orgName,
    orgAddress,
    orgMission,
    orgTaxStatus,
  } = options ?? {}
  // Find donor name from the most recent row
  const donorName =
    [...rows].reverse().find((r) => r.donor_name !== null)?.donor_name ??
    'Valued Donor'

  // Process each row into a LetterDonation
  const donations: LetterDonation[] = rows.map((row, i) => {
    const dt = DateTime.fromISO(row.event_ts.value, { zone: 'utc' })
    return {
      index: i + 1,
      date: dt.toFormat('LLLL d, yyyy'),
      amount: row.amount,
      currency: row.currency,
      year: dt.year,
    }
  })

  // Group by year
  const yearMap = new Map<number, LetterDonation[]>()
  for (const donation of donations) {
    const existing = yearMap.get(donation.year) ?? []
    existing.push(donation)
    yearMap.set(donation.year, existing)
  }

  // Build year groups with per-currency totals
  const yearGroups: YearGroup[] = [...yearMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, yearDonations]) => ({
      year,
      donations: yearDonations,
      totals: computeCurrencyTotals(yearDonations),
    }))

  // Compute grand totals across all donations
  const grandTotals = computeCurrencyTotals(donations)

  const date = letterDate ?? DateTime.utc().toFormat('LLLL d, yyyy')

  return {
    donorName,
    date,
    yearGroups,
    grandTotals,
    totalCount: donations.length,
    signerName: signerName ?? DEFAULT_SIGNER_NAME,
    signerTitle: signerTitle ?? DEFAULT_SIGNER_TITLE,
    orgName: orgName ?? DEFAULT_ORG_NAME,
    orgAddress: orgAddress ?? DEFAULT_ORG_ADDRESS,
    orgMission: orgMission ?? DEFAULT_ORG_MISSION,
    orgTaxStatus: orgTaxStatus ?? DEFAULT_ORG_TAX_STATUS,
  }
}

/**
 * Compute per-currency totals from a list of donations.
 */
function computeCurrencyTotals(donations: LetterDonation[]): CurrencyTotal[] {
  const totals = new Map<string, { total: number; count: number }>()

  for (const d of donations) {
    const existing = totals.get(d.currency) ?? { total: 0, count: 0 }
    existing.total += d.amount
    existing.count += 1
    totals.set(d.currency, existing)
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, { total, count }]) => ({
      currency,
      total: Math.round(total * 100) / 100,
      count,
    }))
}

/**
 * Load the logo as a base64 data URI.
 *
 * The logo is baked into the package at assets/logo.png.
 */
export async function loadLogoBase64(): Promise<string> {
  // Try multiple paths: unbundled (relative to src/), bundled (LOGO_PATH env var)
  const candidates = [
    process.env.LOGO_PATH,
    resolve(import.meta.dirname, '..', 'assets', 'logo.png'),
    resolve(process.cwd(), 'packages', 'letter', 'assets', 'logo.png'),
  ].filter((p): p is string => typeof p === 'string')

  for (const logoPath of candidates) {
    try {
      const buffer = await readFile(logoPath)
      const base64 = buffer.toString('base64')
      return `data:image/png;base64,${base64}`
    } catch {
      continue
    }
  }

  return ''
}

/**
 * Generate a complete HTML letter from processed LetterData.
 */
export async function generateLetterHtml(data: LetterData): Promise<string> {
  const logoDataUri = await loadLogoBase64()
  return renderHtml(data, logoDataUri)
}

/**
 * Render the HTML letter template.
 *
 * Separated from generateLetterHtml for testability (no file I/O needed).
 */
export function renderHtml(data: LetterData, logoDataUri: string): string {
  const {
    donorName,
    date,
    yearGroups,
    grandTotals,
    totalCount,
    signerName,
    signerTitle,
    orgName,
    orgAddress,
    orgMission,
    orgTaxStatus,
  } = data
  const isMultiCurrency = grandTotals.length > 1

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Donation Confirmation Letter</title>
<style>
  @page {
    size: letter;
    margin: 0.75in 1in;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #222;
    max-width: 7.5in;
    margin: 0 auto;
    padding: 0.5in;
  }
  .letterhead {
    text-align: center;
    margin-bottom: 0.4in;
    padding-bottom: 0.15in;
    border-bottom: 2px solid #00a0e3;
  }
  .letterhead img {
    height: 80px;
    margin-bottom: 8px;
  }
  .org-name {
    font-size: 18pt;
    font-weight: bold;
    color: #00a0e3;
    letter-spacing: 1px;
  }
  .org-address {
    font-size: 9pt;
    color: #666;
    margin-top: 2px;
  }
  .date {
    text-align: right;
    margin: 0.3in 0 0.2in;
  }
  .recipient {
    margin-bottom: 0.25in;
  }
  .subject {
    font-weight: bold;
    margin-bottom: 0.25in;
  }
  .body-text {
    margin-bottom: 0.2in;
    text-align: justify;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.2in 0;
    font-size: 10pt;
  }
  th {
    background-color: #00a0e3;
    color: white;
    padding: 6px 10px;
    text-align: left;
    font-weight: bold;
  }
  th.amount {
    text-align: right;
  }
  td {
    padding: 5px 10px;
    border-bottom: 1px solid #e0e0e0;
  }
  td.amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tr:nth-child(even) td {
    background-color: #f8f9fa;
  }
  .year-header td {
    background-color: #e8f4fd;
    font-weight: bold;
    color: #00a0e3;
    border-bottom: 2px solid #00a0e3;
    padding: 8px 10px;
  }
  .total-row td {
    font-weight: bold;
    border-top: 2px solid #00a0e3;
    border-bottom: none;
    padding-top: 8px;
  }
  .signature-block {
    margin-top: 0.4in;
  }
  .signature-space {
    height: 0.6in;
  }
  .signature-name {
    font-weight: bold;
  }
  .footer {
    margin-top: 0.5in;
    padding-top: 0.1in;
    border-top: 1px solid #ccc;
    text-align: center;
    font-size: 8pt;
    color: #999;
  }
</style>
</head>
<body>

<div class="letterhead">
  <img src="${logoDataUri}" alt="${orgName} Logo">
  <div class="org-name">${orgName}</div>
  ${orgAddress ? `<div class="org-address">${orgAddress}</div>` : ''}
</div>

<div class="date">${date}</div>

<div class="recipient">${donorName}</div>

<div class="subject">Re: Donation Confirmation Letter</div>

<p class="body-text">
  Dear ${donorName},
</p>

<p class="body-text">
  Thank you for your generous support of ${orgName}. Your contributions make a
  meaningful difference in our mission.
</p>

<p class="body-text">
  ${orgMission}
</p>

<p class="body-text">
  Below is a summary of your donation${totalCount === 1 ? '' : 's'} on record:
</p>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Date</th>
      <th class="amount">Amount${isMultiCurrency ? ' / Currency' : ''}</th>
    </tr>
  </thead>
  <tbody>
${renderTableBody(yearGroups, isMultiCurrency)}
${renderGrandTotals(grandTotals, totalCount, isMultiCurrency)}
  </tbody>
</table>

<p class="body-text">
  This letter confirms that all donation${totalCount === 1 ? '' : 's'} listed above
  ${totalCount === 1 ? 'was' : 'were'} received by ${orgName} and used exclusively
  for charitable purposes.
</p>

<p class="body-text">
  ${orgTaxStatus} No goods or services were provided in
  exchange for ${totalCount === 1 ? 'this contribution' : 'these contributions'}.
</p>

<p class="body-text">
  With sincere gratitude,
</p>

<div class="signature-block">
  <div class="signature-space"></div>
  <div class="signature-name">${signerName}</div>
  <div>${signerTitle}</div>
</div>

<div class="footer">
  ${orgName}${orgAddress ? ` &middot; ${orgAddress}` : ''}
</div>

</body>
</html>`
}

/**
 * Render the table body with year groups.
 */
function renderTableBody(
  yearGroups: YearGroup[],
  isMultiCurrency: boolean,
): string {
  const lines: string[] = []
  const showYearHeaders = yearGroups.length > 1

  for (const group of yearGroups) {
    if (showYearHeaders) {
      lines.push(`    <tr class="year-header">
      <td colspan="3">${String(group.year)}</td>
    </tr>`)
    }

    for (const d of group.donations) {
      const amountDisplay = isMultiCurrency
        ? `${formatAmount(d.amount, d.currency)} ${d.currency}`
        : formatAmount(d.amount, d.currency)

      lines.push(`    <tr>
      <td>${String(d.index)}</td>
      <td>${d.date}</td>
      <td class="amount">${amountDisplay}</td>
    </tr>`)
    }
  }

  return lines.join('\n')
}

/**
 * Render the grand total rows.
 */
function renderGrandTotals(
  grandTotals: CurrencyTotal[],
  totalCount: number,
  isMultiCurrency: boolean,
): string {
  if (isMultiCurrency) {
    return grandTotals
      .map(
        (t) => `    <tr class="total-row">
      <td colspan="2">Total (${t.currency}): ${String(t.count)} donation${t.count === 1 ? '' : 's'}</td>
      <td class="amount">${formatAmount(t.total, t.currency)}</td>
    </tr>`,
      )
      .join('\n')
  }

  const total = grandTotals[0]
  if (!total) return ''

  return `    <tr class="total-row">
      <td colspan="2">Total: ${String(totalCount)} donation${totalCount === 1 ? '' : 's'}</td>
      <td class="amount">${formatAmount(total.total, total.currency)}</td>
    </tr>`
}
