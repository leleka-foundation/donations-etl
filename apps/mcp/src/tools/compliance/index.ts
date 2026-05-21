/**
 * Registration entry point for the compliance MCP surface.
 *
 * The MCP server's `createMcpServerInstance` calls
 * `registerComplianceSurface(mcp, deps)` once per server-instance to
 * attach the tools, resources, and prompts described in
 * `docs/compliance-mcp/PLAN.md`.
 *
 * Per the plan, this commit ships the read surface only:
 *   - Tool:  compliance-status
 *   - Resources: compliance://status,
 *                compliance://sources/registry,
 *                compliance://onboarding/interview-questions,
 *                compliance://sources/{sourceId}/manual-evidence-instructions
 *
 * Write tools (onboard, onboard-update, discover-start/-status/-result,
 * record-evidence) attach in later commits.
 *
 * The callbacks are exported individually so they can be tested without
 * driving a real MCP transport.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { Logger } from 'pino'
import type { Config } from '../../config'
import {
  COMPLIANCE_INTERVIEW_QUESTIONS_URI,
  COMPLIANCE_MANUAL_EVIDENCE_URI_TEMPLATE,
  COMPLIANCE_SOURCES_REGISTRY_URI,
  COMPLIANCE_STATUS_URI,
  buildInterviewQuestionsResource,
  buildManualEvidenceInstructionsResource,
  buildSourceRegistryResource,
  buildStatusResource,
  serialiseStatus,
} from './resources'
import { handleComplianceStatus, type ComplianceStatusReader } from './status'

/**
 * Deps the registration function consumes. The optional `readStatus`
 * override lets the e2e test exercise the registered tool/resource
 * without hitting GCP.
 */
export interface RegisterComplianceSurfaceDeps {
  readonly config: Config
  readonly logger: Logger
  readonly readStatus?: ComplianceStatusReader
}

/**
 * Build the tool callback for `compliance-status`. Exported for direct
 * unit-testing of the formatting/error branches.
 */
export function createStatusToolCallback(
  deps: RegisterComplianceSurfaceDeps,
): () => Promise<CallToolResult> {
  return async () => {
    const result = await handleComplianceStatus({
      config: deps.config,
      logger: deps.logger,
      readStatus: deps.readStatus,
    })
    if (result.isErr()) {
      return {
        content: [
          {
            type: 'text',
            text: `Error (${result.error.type}): ${result.error.message}`,
          },
        ],
        isError: true,
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(serialiseStatus(result.value), null, 2),
        },
      ],
    }
  }
}

/**
 * Build the resource read callback for `compliance://status`.
 */
export function createStatusResourceCallback(
  deps: RegisterComplianceSurfaceDeps,
): () => Promise<ReadResourceResult> {
  return async () => {
    const result = await handleComplianceStatus({
      config: deps.config,
      logger: deps.logger,
      readStatus: deps.readStatus,
    })
    if (result.isErr()) {
      return {
        contents: [
          {
            uri: COMPLIANCE_STATUS_URI,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                error: {
                  type: result.error.type,
                  message: result.error.message,
                },
              },
              null,
              2,
            ),
          },
        ],
      }
    }
    return buildStatusResource(result.value)
  }
}

/**
 * Build the manual-evidence resource template's read callback. Used by
 * both the registration code and direct unit tests.
 */
export function manualEvidenceTemplateCallback(
  uri: URL,
  variables: Variables,
): ReadResourceResult {
  const sourceIdRaw = variables.sourceId
  const sourceId = Array.isArray(sourceIdRaw) ? sourceIdRaw[0] : sourceIdRaw
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              error: 'missing_source_id',
              message:
                'The compliance://sources/{sourceId}/manual-evidence-instructions URI requires a non-empty sourceId.',
            },
            null,
            2,
          ),
        },
      ],
    }
  }
  const built = buildManualEvidenceInstructionsResource(sourceId)
  if (built === null) {
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              error: 'unknown_source',
              message: `No registered compliance source with id "${sourceId}".`,
              sourceId,
            },
            null,
            2,
          ),
        },
      ],
    }
  }
  return built
}

/**
 * Resource callback for `compliance://sources/registry`. Exported so
 * the registration code path is covered by direct unit tests.
 */
export function sourceRegistryResourceCallback(): ReadResourceResult {
  return buildSourceRegistryResource()
}

/**
 * Resource callback for `compliance://onboarding/interview-questions`.
 */
export function interviewQuestionsResourceCallback(): ReadResourceResult {
  return buildInterviewQuestionsResource()
}

/**
 * Register the read-only compliance surface on an MCP server.
 */
export function registerComplianceSurface(
  mcp: McpServer,
  deps: RegisterComplianceSurfaceDeps,
): void {
  const statusToolCallback = createStatusToolCallback(deps)
  const statusResourceCallback = createStatusResourceCallback(deps)

  mcp.registerTool(
    'compliance-status',
    {
      title: 'Compliance Status',
      description:
        "Read the nonprofit's current compliance state: entity row, identifiers, latest per-source discovery runs, and open findings. Returns an overall flag (clear | attention_required | unknown).",
      inputSchema: {},
    },
    statusToolCallback,
  )

  mcp.registerResource(
    'compliance-status-resource',
    COMPLIANCE_STATUS_URI,
    {
      title: 'Compliance Status',
      description:
        'Current compliance state as a JSON snapshot. Mirrors the compliance-status tool but is URI-addressable so the model can pull it as grounding context.',
      mimeType: 'application/json',
    },
    statusResourceCallback,
  )

  mcp.registerResource(
    'compliance-sources-registry',
    COMPLIANCE_SOURCES_REGISTRY_URI,
    {
      title: 'Compliance Sources Registry',
      description:
        'The list of compliance sources known to this server, with access URLs, automation/auth status, and manual-evidence availability.',
      mimeType: 'application/json',
    },
    sourceRegistryResourceCallback,
  )

  mcp.registerResource(
    'compliance-interview-questions',
    COMPLIANCE_INTERVIEW_QUESTIONS_URI,
    {
      title: 'Compliance Onboarding Interview Questions',
      description:
        'Field metadata for the onboarding interview. Each entry has a field name, prompt, kind, and whether it is optional. The host model uses this to drive the question-by-question collection before calling compliance-onboard.',
      mimeType: 'application/json',
    },
    interviewQuestionsResourceCallback,
  )

  mcp.registerResource(
    'compliance-manual-evidence-instructions',
    new ResourceTemplate(COMPLIANCE_MANUAL_EVIDENCE_URI_TEMPLATE, {
      list: undefined,
    }),
    {
      title: 'Compliance Manual Evidence Instructions',
      description:
        'Per-source instructions and evidence-field metadata for sources that require user-assisted authenticated checks. The model uses these to walk the user through a portal login + paste workflow before calling compliance-record-evidence.',
      mimeType: 'application/json',
    },
    manualEvidenceTemplateCallback,
  )
}
