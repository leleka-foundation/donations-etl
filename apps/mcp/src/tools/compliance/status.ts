/**
 * MCP tool: compliance-status
 *
 * Reads the entity row, identifiers (from Secret Manager), latest
 * per-source discovery runs, and open findings; assembles them into a
 * `ComplianceStatusReport` plus an `overall` flag the model can react to.
 *
 * The tool is read-only. No `confirm` flag is required.
 */
import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'
import type { Logger } from 'pino'
import { getComplianceStatusProduction } from '../../../../../src/compliance/skills/status-wiring.ts'
import type { ComplianceStatusReport } from '../../../../../src/compliance/skills/status.ts'
import type { Config } from '../../config'

/**
 * Reader callback shape. Default points at the production wiring; tests
 * inject a fake that returns canned data.
 */
export type ComplianceStatusReader = (
  projectId: string,
) => ReturnType<typeof getComplianceStatusProduction>

/**
 * Default reader — adapts the production wiring's args-object signature
 * to the single-`projectId` reader contract. Exported for direct unit
 * testing of the adapter (the wiring itself is tested under
 * `src/compliance/tests/status-wiring.test.ts`).
 */
export const defaultComplianceStatusReader: ComplianceStatusReader = (
  projectId,
) => getComplianceStatusProduction({ projectId })

/**
 * Resolve the reader to use: caller-provided or default. Extracted so
 * the `?? defaultComplianceStatusReader` branch is directly testable
 * without driving the production wiring.
 */
export function resolveStatusReader(
  override?: ComplianceStatusReader,
): ComplianceStatusReader {
  return override ?? defaultComplianceStatusReader
}

/**
 * Dependencies injected into the handler. Mirrors the other MCP tool
 * handlers in this package.
 */
export interface ComplianceStatusDeps {
  readonly config: Config
  readonly logger: Logger
  /**
   * Override the production wiring (used by tests). When omitted, the
   * handler calls the GCP-backed `getComplianceStatusProduction`.
   */
  readonly readStatus?: ComplianceStatusReader
}

/**
 * Error envelope. The MCP layer converts this into a textual `isError`
 * response; the structured shape is preserved for unit tests.
 */
export interface ComplianceStatusError {
  readonly type: 'not_onboarded' | 'load'
  readonly message: string
}

/**
 * Run the read.
 */
export async function handleComplianceStatus(
  deps: ComplianceStatusDeps,
): Promise<Result<ComplianceStatusReport, ComplianceStatusError>> {
  const { config, logger } = deps
  logger.info('compliance-status tool called')

  const reader = resolveStatusReader(deps.readStatus)
  const result = await reader(config.PROJECT_ID)

  if (result.isErr()) {
    return err({
      type: result.error.type,
      message: result.error.message,
    })
  }
  return ok(result.value)
}
