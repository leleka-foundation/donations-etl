/**
 * Tests for the server-side Markdown renderer that the compliance-
 * status tool returns as primary content.
 *
 * Focus: the renderer is what closes the loop with the user — if it
 * regresses, the model goes back to writing unlinked, date-unaware
 * narratives. Every branch (overdue/upcoming, auth_required vs
 * substantive findings, detailUrl vs accessUrl, parseable vs
 * unparseable dates, info findings filtered from action items) is
 * exercised.
 */
import { describe, expect, it } from 'vitest'
import { renderComplianceStatusMarkdown } from '../../src/tools/compliance/render-status'
import type {
  ComplianceStatusSourceMeta,
  EnrichedComplianceStatusReport,
} from '../../src/tools/compliance/status'

const NOW_ISO = '2026-05-21T12:00:00.000Z'

const SOURCES: readonly ComplianceStatusSourceMeta[] = [
  {
    sourceId: 'ca-sos-bizfile',
    agency: 'California Secretary of State',
    description: 'CA SOS public bizfile search.',
    accessUrl: 'https://bizfileonline.sos.ca.gov/search/business',
    tosUrl: 'https://www.sos.ca.gov/administration/conditions-use',
    automationAllowed: true,
  },
  {
    sourceId: 'ca-ag-registry',
    agency: 'California Attorney General — Registry of Charitable Trusts',
    description: 'CA AG Registry of Charitable Trusts public search.',
    accessUrl: 'https://rct.doj.ca.gov/Verification/Web/Search.aspx',
    tosUrl: 'https://oag.ca.gov/charities',
    automationAllowed: true,
  },
  {
    sourceId: 'ca-ftb-myftb',
    agency: 'California Franchise Tax Board',
    description: 'CA FTB MyFTB user-authenticated business account.',
    accessUrl: 'https://www.ftb.ca.gov/myftb/',
    tosUrl: 'https://www.ftb.ca.gov/help/conditions-of-use.html',
    automationAllowed: true,
    auth: {
      loginUrl: 'https://www.ftb.ca.gov/myftb/',
      instructions: [
        'Sign in to MyFTB at the link.',
        'Open the Account Summary page for the business.',
      ],
      evidenceFields: [
        { key: 'accountBalance', label: 'Account balance', required: true },
      ],
      forbiddenActions: ['Do not file returns.'],
    },
  },
  {
    sourceId: 'ca-ftb-entity-status-letter',
    agency: 'California Franchise Tax Board',
    description: 'CA FTB Entity Status Letter public lookup.',
    accessUrl: 'https://webapp.ftb.ca.gov/eletter/',
    tosUrl: 'https://www.ftb.ca.gov/help/conditions-of-use.html',
    automationAllowed: true,
  },
  {
    sourceId: 'irs-teos',
    agency: 'IRS',
    description: 'IRS TEOS Pub. 78 download.',
    accessUrl: 'https://apps.irs.gov/app/eos/',
    tosUrl: 'https://www.irs.gov/privacy-disclosure/privacy-notice',
    automationAllowed: true,
  },
]

function buildReport(
  overrides: Partial<EnrichedComplianceStatusReport> = {},
): EnrichedComplianceStatusReport {
  return {
    overall: 'attention_required',
    now: NOW_ISO,
    entity: {
      legal_name: 'Test Foundation',
      state_of_incorporation: 'DC',
      fiscal_year_end_month: 12,
      fiscal_year_end_day: 31,
      formation_date: '2014-12-14',
      mailing_address_line1: '380 Hamilton Ave',
      mailing_address_line2: 'Unit 291',
      mailing_address_city: 'Palo Alto',
      mailing_address_region: 'CA',
      mailing_address_postal_code: '94302-2405',
      mailing_address_country: 'US',
      updated_at: '2026-05-01T00:00:00Z',
    },
    identifiers: {
      'us-federal': { ein: '47-2377309' },
      'us-ca': { sosEntityNumber: '6423690', agCharityNumber: 'CT0292660' },
    },
    sources: SOURCES,
    latestRuns: [],
    openFindings: [],
    ...overrides,
  }
}

describe('renderComplianceStatusMarkdown — structure', () => {
  it('opens with the entity legal name as the H1 and an overall-status line', () => {
    const out = renderComplianceStatusMarkdown(buildReport())
    expect(out).toContain('# Compliance Status: Test Foundation')
    expect(out).toMatch(/Attention Required/)
    expect(out).toContain('2026-05-21 12:00 UTC')
  })

  it('renders an Entity section with the mailing address joined', () => {
    const out = renderComplianceStatusMarkdown(buildReport())
    expect(out).toContain('## Entity')
    expect(out).toContain(
      '380 Hamilton Ave, Unit 291, Palo Alto, CA, 94302-2405',
    )
  })

  it('omits null mailing-address lines from the joined address', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        entity: {
          ...buildReport().entity,
          mailing_address_line2: null,
        },
      }),
    )
    expect(out).toContain('380 Hamilton Ave, Palo Alto, CA, 94302-2405')
    expect(out).not.toContain('null')
  })

  it('shows a "no action items" line when there are no findings or deadlines', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({ overall: 'clear' }),
    )
    expect(out).toContain('## Action items')
    expect(out).toContain('No action items')
  })

  it('uses the right overall label for each value', () => {
    expect(
      renderComplianceStatusMarkdown(buildReport({ overall: 'clear' })),
    ).toContain('✅ Clear')
    expect(
      renderComplianceStatusMarkdown(buildReport({ overall: 'unknown' })),
    ).toContain('❓ Unknown')
  })
})

describe('renderComplianceStatusMarkdown — per-source rows', () => {
  it('uses payload.detailUrl as the primary link when available', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440000',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:55:00.000Z',
            completed_at: '2026-05-21T11:55:30.000Z',
            duration_ms: 30000,
            error_type: null,
            error_message: null,
            payload: {
              detailUrl:
                'https://rct.doj.ca.gov/Verification/Web/Details.aspx?result=abc',
              renewalDueDate: '5/15/2026',
            },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain(
      '[ca-ag-registry](https://rct.doj.ca.gov/Verification/Web/Details.aspx?result=abc)',
    )
  })

  it('falls back to the source accessUrl when payload has no detailUrl', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440001',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { matchStatus: 'found' },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain(
      '[ca-sos-bizfile](https://bizfileonline.sos.ca.gov/search/business)',
    )
  })

  it('falls back to accessUrl when payload is a non-object', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440002',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: 'a string payload',
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain(
      '[ca-sos-bizfile](https://bizfileonline.sos.ca.gov/search/business)',
    )
  })

  it('still picks accessUrl when detailUrl is empty or non-string', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440003',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { detailUrl: '' },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain(
      '[ca-ag-registry](https://rct.doj.ca.gov/Verification/Web/Search.aspx)',
    )
  })

  it('renders a failed run with the error type and message', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440004',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'failed',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: 'network',
            error_message: 'connection reset',
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('❌ network')
    expect(out).toContain('connection reset')
  })

  it('renders an auth_required failure with loginUrl + first 2 instructions', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440005',
            source_id: 'ca-ftb-myftb',
            jurisdiction_id: 'us-ca',
            status: 'failed',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: 'auth_required',
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('🔐 **Authentication required.**')
    expect(out).toContain('https://www.ftb.ca.gov/myftb/')
    expect(out).toContain('Sign in to MyFTB at the link.')
    expect(out).toContain('Open the Account Summary page for the business.')
    expect(out).toContain('`sourceId: ca-ftb-myftb`')
  })

  it('renders a failed run with null error_type as "failed"', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655441000',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'failed',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('❌ failed')
  })

  it('renders an auth_required failure without auth metadata as a bare "auth required"', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440006',
            source_id: 'unknown-source-no-meta',
            jurisdiction_id: 'us-ca',
            status: 'failed',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: 'auth_required',
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('auth required')
  })
})

describe('renderComplianceStatusMarkdown — date arithmetic', () => {
  it('marks a past renewal as overdue with the exact day count', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440007',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: '5/15/2026' },
            job_id: null,
          },
        ],
      }),
    )
    // 5/15 -> 5/21 = 6 days overdue
    expect(out).toContain('Overdue by 6 days')
  })

  it('marks an upcoming renewal with days remaining', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440008',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: '6/15/2026' },
            job_id: null,
          },
        ],
      }),
    )
    // 5/21 -> 6/15 = 25 days
    expect(out).toContain('Due in 25 days')
  })

  it('skips items in the action list when renewal is more than 60 days away', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        overall: 'clear',
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440009',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: '12/15/2026' },
            job_id: null,
          },
        ],
      }),
    )
    // No "Due in X days" / "Overdue" line in action items for a 200+ day window.
    expect(out).not.toMatch(/\*\*\[Due in/)
    expect(out).toContain('No action items')
  })

  it('skips relative formatting when the date is unparseable', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440010',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: 'not-a-date-at-all',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: 'whenever' },
            job_id: null,
          },
        ],
      }),
    )
    // The unparseable observation date appears as-is, not as "ago".
    expect(out).toContain('not-a-date-at-all')
  })

  it('uses MM/dd/yyyy (zero-padded) for renewal dates if that is what the source returns', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440011',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: '05/15/2026' },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('Overdue by 6 days')
  })

  it('renders "checked just now" when completed_at == now', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440012',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: NOW_ISO,
            completed_at: NOW_ISO,
            duration_ms: 0,
            error_type: null,
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('just now')
  })

  it('renders "checked N hours ago" for sub-day windows', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440013',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T08:00:00.000Z',
            completed_at: '2026-05-21T08:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('hours ago')
  })

  it('renders "checked N days ago" for multi-day windows', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440098',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            // 3 days before NOW_ISO (2026-05-21T12:00Z)
            started_at: '2026-05-18T12:00:00.000Z',
            completed_at: '2026-05-18T12:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('days ago')
  })

  it('falls back to absolute date when the observation is in the future', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440099',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-25T11:00:00.000Z',
            completed_at: '2026-05-25T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    // Future date shows as plain date, not "ago".
    expect(out).toContain('2026-05-25')
    expect(out).not.toMatch(/2026-05-25.*ago/)
  })

  it('renders "checked N minutes ago" for sub-hour windows', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440014',
            source_id: 'ca-sos-bizfile',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:30:00.000Z',
            completed_at: '2026-05-21T11:30:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: null,
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('minutes ago')
  })
})

describe('renderComplianceStatusMarkdown — findings and action items', () => {
  it('renders an open finding with severity emoji + source link + detail', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440020',
            source_id: 'ca-ftb-entity-status-letter',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'California FTB exempt status is not verified',
            detail: 'Entity Status Letter shows NOT EXEMPT.',
            evidence: { code: 'ca.ftb.exempt_status_not_verified' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    expect(out).toContain('## Open findings (1)')
    expect(out).toContain('⚠️')
    expect(out).toContain('California FTB exempt status is not verified')
    expect(out).toContain(
      '[ca-ftb-entity-status-letter](https://webapp.ftb.ca.gov/eletter/)',
    )
  })

  it('does NOT generate an action item for info-severity findings', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440021',
            source_id: 'irs-teos',
            jurisdiction_id: 'us-federal',
            severity: 'info',
            status: 'open',
            title: 'EIN listed in IRS Pub. 78',
            detail: 'Positive listing.',
            evidence: { code: 'irs.teos.pub78_listed' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    // The finding is in the Open findings list, but the Action items
    // section should still report "no action items".
    expect(out).toContain('EIN listed in IRS Pub. 78')
    expect(out).toContain('No action items')
  })

  it('renders an action item with the loginUrl for an auth_required finding', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440022',
            source_id: 'ca-ftb-myftb',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'Authentication required for MyFTB',
            detail: 'MyFTB requires a session.',
            evidence: {
              code: 'source.auth_required',
              loginUrl: 'https://www.ftb.ca.gov/myftb/',
            },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    expect(out).toContain('## Action items')
    expect(out).toContain('Sign in to California Franchise Tax Board')
    expect(out).toContain('https://www.ftb.ca.gov/myftb/')
    expect(out).toContain('`sourceId: ca-ftb-myftb`')
  })

  it('skips the action item for an auth_required finding that has no source metadata', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440023',
            source_id: 'no-such-source',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'Authentication required for mystery source',
            detail: 'No metadata.',
            evidence: { code: 'source.auth_required' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    // The finding is rendered but the action item is skipped because
    // we don't have a loginUrl to point the user to.
    expect(out).toContain('Authentication required for mystery source')
    expect(out).toContain('No action items')
  })

  it('renders an [Investigate] action for a substantive warn finding', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440024',
            source_id: 'ca-ftb-entity-status-letter',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'California FTB exempt status is not verified',
            detail: 'Entity Status Letter shows NOT EXEMPT.',
            evidence: { code: 'ca.ftb.exempt_status_not_verified' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    expect(out).toContain('**[Investigate]**')
    expect(out).toContain('California FTB exempt status is not verified')
  })

  it('renders [Blocker] for error-severity findings', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440025',
            source_id: 'ca-ftb-entity-status-letter',
            jurisdiction_id: 'us-ca',
            severity: 'error',
            status: 'open',
            title: 'Hard block',
            detail: 'Stop the world.',
            evidence: { code: 'ca.ftb.block' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    expect(out).toContain('🛑')
    expect(out).toContain('**[Blocker]**')
  })

  it('sorts overdue items ahead of upcoming items in the action list', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440026',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            // 30 days overdue
            payload: { renewalDueDate: '4/21/2026' },
            job_id: null,
          },
        ],
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440027',
            source_id: 'ca-ftb-myftb',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'MyFTB auth required',
            detail: 'auth',
            evidence: {
              code: 'source.auth_required',
              loginUrl: 'https://www.ftb.ca.gov/myftb/',
            },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    const overdueIdx = out.indexOf('Overdue by')
    const authIdx = out.indexOf('Sign in to California Franchise Tax Board')
    expect(overdueIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeGreaterThan(-1)
    expect(overdueIdx).toBeLessThan(authIdx)
  })

  it('skips renewal payloads whose renewalDueDate is non-string', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        overall: 'clear',
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440028',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: 12345 },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('No action items')
  })

  it('renders the overdue action item without a link when source metadata is missing', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        sources: [],
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440101',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: '5/15/2026' },
            job_id: null,
          },
        ],
      }),
    )
    // Still mentions the overdue status but without the [Open entity record] link.
    expect(out).toContain('Overdue by 6 days')
    expect(out).not.toContain('[Open entity record]')
  })

  it('renders the upcoming-renewal action item without a link when source metadata is missing', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        sources: [],
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440102',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: '6/15/2026' },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('Due in 25 days')
    expect(out).not.toContain('[Open entity record]')
  })

  it('handles an empty instructions array on an auth_required finding', () => {
    const customSources: readonly ComplianceStatusSourceMeta[] = [
      {
        sourceId: 'ca-ftb-myftb',
        agency: 'California Franchise Tax Board',
        description: 'x',
        accessUrl: 'https://www.ftb.ca.gov/myftb/',
        tosUrl: 'https://www.ftb.ca.gov/help/conditions-of-use.html',
        automationAllowed: true,
        auth: {
          loginUrl: 'https://www.ftb.ca.gov/myftb/',
          instructions: [], // intentionally empty
          evidenceFields: [],
          forbiddenActions: [],
        },
      },
    ]
    const out = renderComplianceStatusMarkdown(
      buildReport({
        sources: customSources,
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440103',
            source_id: 'ca-ftb-myftb',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'Auth required',
            detail: 'sign in',
            evidence: { code: 'source.auth_required' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    expect(out).toContain('Sign in to California Franchise Tax Board')
    expect(out).toContain('`sourceId: ca-ftb-myftb`')
  })

  it('renders a substantive warn finding without a link when source meta is missing', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        sources: [],
        openFindings: [
          {
            finding_id: '550e8400-e29b-41d4-a716-446655440104',
            source_id: 'ca-ftb-entity-status-letter',
            jurisdiction_id: 'us-ca',
            severity: 'warn',
            status: 'open',
            title: 'FTB not exempt',
            detail: 'investigate',
            evidence: { code: 'ca.ftb.exempt_status_not_verified' },
            opened_at: '2026-05-21T11:00:00.000Z',
            resolved_at: null,
          },
        ],
      }),
    )
    expect(out).toContain('**[Investigate]**')
    expect(out).toContain('FTB not exempt')
    // No "[Open …]" linked-agency suffix because meta is missing.
    expect(out).not.toMatch(/\[Open California /)
  })

  it('skips renewal payloads whose date does not parse', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        overall: 'clear',
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440029',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: { renewalDueDate: 'not-a-date' },
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('No action items')
  })

  it('handles a non-object payload (string) when looking for renewalDueDate', () => {
    const out = renderComplianceStatusMarkdown(
      buildReport({
        overall: 'clear',
        latestRuns: [
          {
            run_id: '550e8400-e29b-41d4-a716-446655440030',
            source_id: 'ca-ag-registry',
            jurisdiction_id: 'us-ca',
            status: 'succeeded',
            started_at: '2026-05-21T11:00:00.000Z',
            completed_at: '2026-05-21T11:00:01.000Z',
            duration_ms: 1000,
            error_type: null,
            error_message: null,
            payload: 'a string payload',
            job_id: null,
          },
        ],
      }),
    )
    expect(out).toContain('No action items')
  })
})
