---
name: donor-letter
description: >
  Generate a formal donation confirmation letter for a donor. Use this skill whenever the user
  asks to write a letter, confirmation, receipt, acknowledgment, or thank-you for a donor.
  Triggers on phrases like "write a letter for donor", "donation confirmation letter",
  "donor acknowledgment", "generate a receipt for donations", "make a letter like we did before",
  or when someone provides a donor email and asks for documentation of their contributions.
  Also use when the user forwards a donor's request for confirmation of their giving history.
---

# Donor Confirmation Letter Generator

Generate a professional HTML donation confirmation letter by querying the donor's transaction
history from BigQuery and producing a formatted, printable document.

## Inputs

The user will provide:

1. **Donor email(s)** — one or more email addresses (the same person may have donated with different emails)
2. **Timeframe** (optional) — a date range to filter donations. If not specified, include all donations on record.

## Step 1: Query donations

Read PROJECT_ID from `.env` or `.env.local` in the project root. Then query BigQuery for the donor's records:

```bash
bq query --use_legacy_sql=false --format=prettyjson "
SELECT
  event_ts,
  ROUND(amount_cents / 100, 2) AS amount,
  currency,
  source,
  status
FROM \`<PROJECT_ID>.donations.events\`
WHERE donor_email IN (<comma-separated quoted emails>)
  AND status = 'succeeded'
  <AND event_ts date filter if timeframe given>
ORDER BY event_ts ASC
"
```

If the user specified a timeframe, add appropriate `event_ts` filters.

If no results are returned, tell the user and ask them to double-check the email address.

## Step 2: Generate the letter

Create an HTML file at `~/Downloads/donation-confirmation-<lastname>.html`.

The letter must include these elements, in this order:

### Letterhead

- Embed the logo at `~/Downloads/logo.png` as a base64 data URI (read and encode the file), if the file exists
- Organization name: read `ORG_NAME` from `.env` or `.env.local` (e.g., "Your Organization")
- Address: read `ORG_ADDRESS` from `.env` or `.env.local`

### Date

Today's date, right-aligned.

### Recipient

The donor's name (from the query results — use the most recent `donor_name` value).

### Subject line

"Re: Donation Confirmation Letter"

### Body

The letter body should include:

1. **Opening** — thank the donor for their support of the organization (use `ORG_NAME` from `.env`)
2. **About the organization** — brief paragraph using the `ORG_MISSION` value from `.env` or `.env.local`. All contributions are directed toward the organization's charitable purposes.
3. **Transaction table** — all donations listed chronologically with:
   - Row number
   - Date (formatted like "January 23, 2025")
   - Amount with currency symbol
   - Group rows by year with year headers
   - Total row at the bottom with count and sum
4. **Confirmation paragraph** — confirm that all donations were received and used exclusively for the organization's charitable purposes
5. **Tax status** — use the `ORG_TAX_STATUS` value from `.env` or `.env.local`. Mention no goods or services were provided in exchange.
6. **Closing** — "With sincere gratitude,"

### Signature block

Leave space for a signature, then:

- Read `DEFAULT_SIGNER_NAME` from `.env` or `.env.local` (e.g., "Organization Leader")
- Read `DEFAULT_SIGNER_TITLE` from `.env` or `.env.local`, followed by the organization name from `ORG_NAME`

### Footer

- Organization name (from `ORG_NAME`) with the address (from `ORG_ADDRESS`), centered, small text

## Style guidelines

The letter should look professional and be print-ready. Use:

- Georgia or Times New Roman for body text, ~11pt
- A blue accent color (#00a0e3) for the org name and table headers
- Clean table styling with alternating row backgrounds
- Proper `@page` CSS for letter-size paper with margins
- Tabular number formatting for the amount column

## Step 3: Open the letter

After writing the file, open it in the browser:

```bash
open ~/Downloads/donation-confirmation-<lastname>.html
```

Tell the user the file location so they can print to PDF (Cmd+P) from the browser.

## Multi-currency handling

If the donor has donations in multiple currencies, show the currency on each row and provide separate totals per currency at the bottom of the table. Do not mix currencies in a single sum.

## Name on the letter

Use the `donor_name` from the most recent donation record. If the user provides a specific name to use, prefer that.
