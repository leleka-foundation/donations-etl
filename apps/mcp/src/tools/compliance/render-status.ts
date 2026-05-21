/**
 * Server-side rendering for compliance-status.
 *
 * Why this exists at the MCP boundary (not in the pure backend):
 * compliance-status returns rich structured JSON, but the host LLM
 * receives only a single text block in the tool result. Without a
 * server-rendered narrative, the model decides on its own which fields
 * to surface, often skipping links, skipping date arithmetic, and
 * issuing vague action items like "provide authenticated sessions"
 * without telling the user *how*. We render the narrative here so the
 * model can emit it verbatim and the user gets a consistent,
 * linkable, date-aware report.
 *
 * MCP prompts (compliance-overview) are user-invoked and not loaded by
 * default when a client just calls the tool — so prompt-side rendering
 * instructions have no effect on what the user sees. The fix has to
 * live in the tool response.
 */
import { DateTime } from 'luxon'
import type { Finding } from '../../../../../src/compliance/types/index.ts'
import type {
  ComplianceStatusSourceMeta,
  EnrichedComplianceStatusReport,
} from './status'

const SEVERITY_EMOJI: Record<Finding['severity'], string> = {
  warn: '⚠️',
  error: '🛑',
  info: 'ℹ️',
}

const OVERALL_LABEL: Record<EnrichedComplianceStatusReport['overall'], string> =
  {
    clear: '✅ Clear',
    attention_required: '⚠️ Attention Required',
    unknown: '❓ Unknown',
  }

const STATUS_TAG: Record<'succeeded' | 'failed', string> = {
  succeeded: '✅',
  failed: '❌',
}

/**
 * Index sources by id so we can dereference per-finding / per-run
 * lookups in O(1).
 */
function indexSources(
  sources: readonly ComplianceStatusSourceMeta[],
): ReadonlyMap<string, ComplianceStatusSourceMeta> {
  const m = new Map<string, ComplianceStatusSourceMeta>()
  for (const s of sources) {
    m.set(s.sourceId, s)
  }
  return m
}

/**
 * The CA AG registry payload has a per-entity `detailUrl`. Any other
 * source-specific detail URLs follow the same pattern: we look for
 * `detailUrl` on the parsed payload and fall back to the source's
 * generic accessUrl.
 *
 * Note: payload is `unknown` from the row schema. We touch it safely
 * here (typeof / property check) rather than asserting a shape, since
 * different sources persist different payload structures.
 */
function pickPrimaryLink(
  source: ComplianceStatusSourceMeta | undefined,
  payload: unknown,
): string | undefined {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'detailUrl' in payload
  ) {
    const detail = payload.detailUrl
    if (typeof detail === 'string' && detail.length > 0) {
      return detail
    }
  }
  return source?.accessUrl
}

/**
 * Parse a date string into a Luxon DateTime. Supports both ISO-8601
 * (most timestamps in the system) and US-style "M/D/YYYY" (the CA AG
 * registry returns dates in this format on the public detail page).
 * Returns null if neither parse works — caller skips relative
 * formatting in that case.
 */
function parseDate(input: string): DateTime | null {
  const iso = DateTime.fromISO(input, { zone: 'utc' })
  if (iso.isValid) return iso
  // Luxon's M/d/yyyy parser accepts both "5/15/2026" and "05/15/2026"
  // — covers both the loose and zero-padded forms the CA AG registry
  // emits.
  const us = DateTime.fromFormat(input, 'M/d/yyyy', { zone: 'utc' })
  if (us.isValid) return us
  return null
}

/**
 * Render an observation date relative to `now`:
 *   "2026-05-21 — 12 minutes ago" / "2 hours ago" / "5 days ago".
 * Returns just the original input if we can't parse it. Used for
 * "checked" / "completed" framings; deadline math (overdue / due in)
 * is handled inline in deriveActionItems because deadlines need
 * day-boundary semantics, not millisecond-precision elapsed time.
 */
function renderRelativeDate(input: string, now: DateTime): string {
  const dt = parseDate(input)
  if (dt === null) return input
  const diffMs = dt.toMillis() - now.toMillis()
  const absMs = Math.abs(diffMs)
  const minutes = Math.floor(absMs / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const display = dt.toFormat('yyyy-LL-dd')
  const phrase = (() => {
    if (diffMs > 0) {
      // future observation is unusual; fall back to absolute date
      return display
    }
    if (days > 0) return `${String(days)} days ago`
    if (hours > 0) return `${String(hours)} hours ago`
    if (minutes > 0) return `${String(minutes)} minutes ago`
    return 'just now'
  })()
  return `${display} — **${phrase}**`
}

/**
 * Render one per-source row in the results table. Includes the
 * source's emoji status, agency, primary link, and (for auth-required
 * sources) a sign-in link + 1-2 instruction bullets.
 */
function renderSourceRow(
  run: EnrichedComplianceStatusReport['latestRuns'][number],
  sources: ReadonlyMap<string, ComplianceStatusSourceMeta>,
  now: DateTime,
): string {
  const meta = sources.get(run.source_id)
  const tag = STATUS_TAG[run.status]
  const agency = meta?.agency ?? '(unknown agency)'
  const link = pickPrimaryLink(meta, run.payload)
  const linkText = link === undefined ? '' : ` — [${run.source_id}](${link})`
  const checked = renderRelativeDate(run.completed_at, now)
  const failureSummary = (() => {
    if (run.status !== 'failed') return ''
    if (run.error_type === 'auth_required') {
      // surfaces the loginUrl + first 2 instruction bullets so the
      // user knows exactly where to sign in and what to do once in.
      const auth = meta?.auth
      if (auth === undefined) return ' — auth required'
      const instructions = auth.instructions
        .slice(0, 2)
        .map((i) => `      - ${i}`)
        .join('\n')
      return `\n   - 🔐 **Authentication required.** Sign in: [${agency}](${auth.loginUrl})\n${instructions}\n      - Then run \`compliance-record-evidence\` with \`sourceId: ${run.source_id}\` to upload what you see.`
    }
    const errType = run.error_type ?? 'failed'
    const errMsg =
      run.error_message === null ? '' : `: ${run.error_message.slice(0, 200)}`
    return ` — ❌ ${errType}${errMsg}`
  })()
  return `- ${tag} **${agency}**${linkText}${failureSummary}\n   - _checked ${checked}_`
}

/**
 * Render one open finding. Severity emoji + title + linked source +
 * one-line "what / why".
 */
function renderFinding(
  finding: Finding,
  sources: ReadonlyMap<string, ComplianceStatusSourceMeta>,
): string {
  const meta = sources.get(finding.source_id)
  const link =
    meta === undefined
      ? finding.source_id
      : `[${finding.source_id}](${meta.accessUrl})`
  const emoji = SEVERITY_EMOJI[finding.severity]
  return `- ${emoji} **${finding.title}** (${link})\n   - ${finding.detail}`
}

/**
 * Action items are derived heuristically from open findings + a few
 * payload-level signals (renewal due dates). Sorted by urgency:
 *   overdue deadlines → upcoming deadlines → substantive warnings →
 *   auth_required → info.
 */
interface ActionItem {
  readonly urgency: number // lower = more urgent
  readonly text: string
}

function deriveActionItems(
  report: EnrichedComplianceStatusReport,
  now: DateTime,
  sources: ReadonlyMap<string, ComplianceStatusSourceMeta>,
): readonly string[] {
  const items: ActionItem[] = []

  // ── Payload-derived deadlines ──────────────────────────────────
  // Anything with a renewalDueDate (today: CA AG registry) gets
  // sorted by how close the deadline is.
  for (const run of report.latestRuns) {
    const p = run.payload
    if (p === null || typeof p !== 'object' || !('renewalDueDate' in p)) {
      continue
    }
    const due = p.renewalDueDate
    if (typeof due !== 'string') continue
    const dt = parseDate(due)
    if (dt === null) continue
    // Compare on day boundaries (both in UTC). 5/15 vs 5/21 should
    // read as "6 days" — not 7 because `now` happens to be at noon
    // UTC, which is what millisecond-floor arithmetic would give.
    const diffDays = Math.round(
      (dt.startOf('day').toMillis() - now.startOf('day').toMillis()) /
        86_400_000,
    )
    const meta = sources.get(run.source_id)
    const link = pickPrimaryLink(meta, p)
    const linkLine = link === undefined ? '' : ` [Open entity record](${link})`
    if (diffDays < 0) {
      items.push({
        urgency: -diffDays * -1, // most overdue → most urgent
        text: `**[Overdue by ${String(-diffDays)} days]** Renew ${meta?.agency ?? run.source_id} registration. Renewal was due ${due} (today is ${now.toFormat('yyyy-LL-dd')}).${linkLine}`,
      })
    } else if (diffDays <= 60) {
      items.push({
        urgency: 1000 + diffDays,
        text: `**[Due in ${String(diffDays)} days]** Renew ${meta?.agency ?? run.source_id} registration before ${due}.${linkLine}`,
      })
    }
  }

  // ── Findings-derived items ─────────────────────────────────────
  for (const finding of report.openFindings) {
    if (finding.severity === 'info') continue // covered in findings list, not an action
    const meta = sources.get(finding.source_id)
    const isAuthRequired = finding.evidence?.code === 'source.auth_required'

    if (isAuthRequired) {
      // Skip the action item if we have no source meta (and thus no
      // loginUrl) to point the user to.
      const auth = meta?.auth
      if (meta !== undefined && auth !== undefined) {
        const firstInstruction = auth.instructions[0]
        const instructionSuffix =
          firstInstruction === undefined ? '' : ` ${firstInstruction}`
        items.push({
          urgency: 5000,
          text: `**[Auth required]** Sign in to ${meta.agency} → [${auth.loginUrl}](${auth.loginUrl}).${instructionSuffix} Then run \`compliance-record-evidence\` with \`sourceId: ${finding.source_id}\`.`,
        })
      }
    } else {
      // Substantive warning (e.g. ca.ftb.exempt_status_not_verified)
      const link =
        meta === undefined ? '' : ` [Open ${meta.agency}](${meta.accessUrl})`
      items.push({
        urgency: 100,
        text: `**[${finding.severity === 'error' ? 'Blocker' : 'Investigate'}]** ${finding.title} — ${finding.detail}${link}`,
      })
    }
  }

  if (items.length === 0) {
    return ['No action items — everything that can be automated is clear.']
  }
  items.sort((a, b) => a.urgency - b.urgency)
  return items.map((i) => i.text)
}

/**
 * Render the full Markdown report. This is what the MCP tool returns
 * as its primary `content[0].text`; the model is expected to emit it
 * largely as-is.
 */
export function renderComplianceStatusMarkdown(
  report: EnrichedComplianceStatusReport,
): string {
  const sources = indexSources(report.sources)
  const now = DateTime.fromISO(report.now, { zone: 'utc' })

  const lines: string[] = []
  lines.push(`# Compliance Status: ${report.entity.legal_name}`)
  lines.push('')
  lines.push(
    `**Overall:** ${OVERALL_LABEL[report.overall]} · _checked ${now.toFormat('yyyy-LL-dd HH:mm')} UTC_`,
  )
  lines.push('')

  lines.push('## Entity')
  lines.push(`- **Legal name:** ${report.entity.legal_name}`)
  lines.push(
    `- **State of incorporation:** ${report.entity.state_of_incorporation}`,
  )
  lines.push(`- **Formation:** ${report.entity.formation_date}`)
  lines.push(
    `- **Fiscal year end:** ${String(report.entity.fiscal_year_end_month).padStart(2, '0')}-${String(report.entity.fiscal_year_end_day).padStart(2, '0')}`,
  )
  lines.push(
    `- **Mailing address:** ${[report.entity.mailing_address_line1, report.entity.mailing_address_line2, report.entity.mailing_address_city, report.entity.mailing_address_region, report.entity.mailing_address_postal_code].filter((v) => v !== null && v !== '').join(', ')}`,
  )
  lines.push('')

  lines.push('## Per-source results')
  for (const run of report.latestRuns) {
    lines.push(renderSourceRow(run, sources, now))
  }
  lines.push('')

  if (report.openFindings.length > 0) {
    lines.push(`## Open findings (${String(report.openFindings.length)})`)
    for (const f of report.openFindings) {
      lines.push(renderFinding(f, sources))
    }
    lines.push('')
  }

  lines.push('## Action items')
  const items = deriveActionItems(report, now, sources)
  items.forEach((text, i) => {
    lines.push(`${String(i + 1)}. ${text}`)
  })
  lines.push('')

  return lines.join('\n')
}
