/**
 * Backend for the async `compliance-discover` flow exposed over MCP.
 *
 * Three operations:
 *   1. `startDiscoveryJob` — write a `discovery_jobs` row with status
 *      `running`, spawn the underlying discovery in the background, and
 *      return the new `jobId` synchronously to the caller.
 *   2. `readDiscoveryJobStatus` — read the parent row + count of completed
 *      per-source runs.
 *   3. `readDiscoveryJobResult` — read the parent row and return its stored
 *      `result` payload, refusing if the job is not yet `completed`.
 *
 * Splitting "spawn" out as an injectable strategy makes the fire-and-forget
 * branch directly testable: tests inject a strategy that records the
 * background promise so the test can await it. Production uses
 * `voidSpawn`, which discards the promise (true fire-and-forget).
 */
import type { ResultAsync } from 'neverthrow'
import { errAsync, okAsync } from 'neverthrow'
import { v4 as uuidv4 } from 'uuid'
import type { RunRecorder } from '../sources/runner.ts'
import type { FindingsAccessor } from '../state/bq-findings.ts'
import type { DiscoveryJobsAccessor } from '../state/bq-jobs.ts'
import type {
  ComplianceDiscoveryJobRow,
  ComplianceDiscoveryRunRow,
} from '../state/bq-rows.ts'
import type { DiscoveryRunsAccessor } from '../state/bq-runs.ts'
import type { Finding } from '../types/index.ts'
import type { DiscoveryError, DiscoveryReport } from './discover.ts'

/**
 * Filter the caller supplied when starting the job. `sources` and
 * `jurisdictionId` are both optional; null means "no restriction".
 */
export interface DiscoveryJobFilter {
  readonly sources: readonly string[] | null
  readonly jurisdictionId: string | null
}

/**
 * Failure modes for the start flow.
 */
export interface StartDiscoveryJobError {
  readonly type: 'persist'
  readonly message: string
}

/**
 * Failure modes for the status read.
 */
export type ReadDiscoveryJobStatusError =
  | { readonly type: 'not_found'; readonly message: string }
  | { readonly type: 'load'; readonly message: string }

/**
 * Failure modes for the result read.
 */
export type ReadDiscoveryJobResultError =
  | { readonly type: 'not_found'; readonly message: string }
  | { readonly type: 'load'; readonly message: string }
  | { readonly type: 'not_ready'; readonly message: string }

/**
 * Strategy injected for spawning the background work. Production wires
 * `voidSpawn`; tests record the promise so the test can await it.
 */
export type SpawnDiscoveryJob = (run: () => Promise<void>) => void

/**
 * Fire-and-forget spawn — used in production. The orchestrator handles every
 * error inside the spawned function before it rejects, so discarding the
 * promise is safe.
 */
export const voidSpawn: SpawnDiscoveryJob = (run) => {
  void run()
}

/**
 * Production-facing alias for the discovery-run function the orchestrator
 * invokes. The orchestrator passes the job-tagged `recorder` so child rows
 * carry the `job_id`. Errors are surfaced as the underlying
 * `DiscoveryError` shape; the orchestrator catches them and persists.
 */
export type RunDiscoveryForJob = (args: {
  readonly filter: DiscoveryJobFilter
  readonly recorder: RunRecorder
}) => ResultAsync<DiscoveryReport, DiscoveryError>

/**
 * Wiring for `startDiscoveryJob`.
 */
export interface StartDiscoveryJobArgs {
  readonly jobsAccessor: DiscoveryJobsAccessor
  readonly runsAccessor: DiscoveryRunsAccessor
  readonly findingsAccessor: FindingsAccessor
  readonly now: () => Date
  readonly filter: DiscoveryJobFilter
  readonly runDiscovery: RunDiscoveryForJob
  readonly spawn?: SpawnDiscoveryJob
  readonly generateJobId?: () => string
  /**
   * Optional logger so the orchestrator can record background failures the
   * caller never sees. Tests can pass a vi.fn() to assert on the log.
   */
  readonly logger?: {
    error: (message: string, err: unknown) => void
  }
}

/**
 * Result envelope returned to the caller. The caller polls
 * `readDiscoveryJobStatus(jobId)` afterwards.
 */
export interface StartDiscoveryJobReport {
  readonly jobId: string
}

/**
 * Insert a `running` job row and kick off the discovery in the background.
 *
 * The synchronous return path tells the MCP caller it can stop waiting and
 * start polling. The background work is responsible for transitioning the
 * row to `completed` (with the serialised report) or `failed` (with the
 * error metadata) before it exits.
 */
export function startDiscoveryJob(
  args: StartDiscoveryJobArgs,
): ResultAsync<StartDiscoveryJobReport, StartDiscoveryJobError> {
  const spawn = args.spawn ?? voidSpawn
  const generateJobId = args.generateJobId ?? uuidv4
  const jobId = generateJobId()
  const startedAt = args.now().toISOString()

  const row: ComplianceDiscoveryJobRow = {
    job_id: jobId,
    started_at: startedAt,
    finished_at: null,
    status: 'running',
    requested_sources: args.filter.sources,
    requested_jurisdiction: args.filter.jurisdictionId,
    error_type: null,
    error_message: null,
    result: null,
  }

  return args.jobsAccessor
    .recordJob(row)
    .mapErr<StartDiscoveryJobError>((err) => ({
      type: 'persist',
      message: `Failed to insert discovery_jobs row: ${err.message}`,
    }))
    .map<StartDiscoveryJobReport>(() => {
      spawn(() => runDiscoveryAndPersist(jobId, args))
      return { jobId }
    })
}

/**
 * Background loop for one job. Exported for direct testing.
 */
export async function runDiscoveryAndPersist(
  jobId: string,
  args: StartDiscoveryJobArgs,
): Promise<void> {
  const recorder = buildJobScopedRecorder(
    jobId,
    args.runsAccessor,
    args.findingsAccessor,
  )

  try {
    const outcome = await args.runDiscovery({
      filter: args.filter,
      recorder,
    })

    if (outcome.isOk()) {
      const finish = await args.jobsAccessor.markJobFinished({
        jobId,
        finishedAt: args.now().toISOString(),
        status: 'completed',
        errorType: null,
        errorMessage: null,
        result: outcome.value,
      })
      if (finish.isErr()) {
        args.logger?.error(
          `Failed to persist completed status for job ${jobId}`,
          finish.error,
        )
      }
      return
    }

    const finish = await args.jobsAccessor.markJobFinished({
      jobId,
      finishedAt: args.now().toISOString(),
      status: 'failed',
      errorType: outcome.error.type,
      errorMessage: outcome.error.message,
      result: null,
    })
    if (finish.isErr()) {
      args.logger?.error(
        `Failed to persist failed status for job ${jobId}`,
        finish.error,
      )
    }
  } catch (err) {
    // Anything not caught by `runDiscovery`'s Result wrapping lands here.
    const message = err instanceof Error ? err.message : String(err)
    const finish = await args.jobsAccessor.markJobFinished({
      jobId,
      finishedAt: args.now().toISOString(),
      status: 'failed',
      errorType: 'spawn',
      errorMessage: message,
      result: null,
    })
    if (finish.isErr()) {
      args.logger?.error(
        `Failed to persist spawn-error status for job ${jobId}`,
        finish.error,
      )
    }
  }
}

/**
 * Wrap the per-job accessors as a `RunRecorder`. Every `discovery_runs` row
 * forwarded through this recorder carries the parent `job_id`; findings
 * pass through unchanged (their `job_id` linkage is implicit via the
 * runs).
 */
export function buildJobScopedRecorder(
  jobId: string,
  runsAccessor: DiscoveryRunsAccessor,
  findingsAccessor: FindingsAccessor,
): RunRecorder {
  return {
    recordRun: (row) => runsAccessor.recordRun({ ...row, job_id: jobId }),
    recordFindings: (findings: readonly Finding[]) =>
      findingsAccessor.recordFindings(findings),
  }
}

/**
 * Status payload returned by `readDiscoveryJobStatus`.
 */
export interface DiscoveryJobStatusReport {
  readonly jobId: string
  readonly status: ComplianceDiscoveryJobRow['status']
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly requestedSources: readonly string[] | null
  readonly requestedJurisdiction: string | null
  readonly completedSourceCount: number
  readonly errorType: string | null
  readonly errorMessage: string | null
}

/**
 * Wiring for the status read.
 */
export interface ReadDiscoveryJobStatusArgs {
  readonly jobsAccessor: DiscoveryJobsAccessor
  readonly runsAccessor: DiscoveryRunsAccessor
  readonly jobId: string
}

/**
 * Read the parent row and count of completed per-source runs for the job.
 */
export function readDiscoveryJobStatus(
  args: ReadDiscoveryJobStatusArgs,
): ResultAsync<DiscoveryJobStatusReport, ReadDiscoveryJobStatusError> {
  return args.jobsAccessor
    .readJob(args.jobId)
    .mapErr<ReadDiscoveryJobStatusError>((err) =>
      err.type === 'not_found'
        ? { type: 'not_found', message: err.message }
        : { type: 'load', message: err.message },
    )
    .andThen((row) =>
      args.runsAccessor
        .listRunsByJob(args.jobId)
        .mapErr<ReadDiscoveryJobStatusError>((err) => ({
          type: 'load',
          message: `Failed to list runs for job ${args.jobId}: ${err.message}`,
        }))
        .map<DiscoveryJobStatusReport>((runs) => buildStatusReport(row, runs)),
    )
}

function buildStatusReport(
  row: ComplianceDiscoveryJobRow,
  runs: readonly ComplianceDiscoveryRunRow[],
): DiscoveryJobStatusReport {
  return {
    jobId: row.job_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    requestedSources: row.requested_sources,
    requestedJurisdiction: row.requested_jurisdiction,
    completedSourceCount: runs.length,
    errorType: row.error_type,
    errorMessage: row.error_message,
  }
}

/**
 * Wiring for the result read.
 */
export interface ReadDiscoveryJobResultArgs {
  readonly jobsAccessor: DiscoveryJobsAccessor
  readonly jobId: string
}

/**
 * Read the assembled `DiscoveryReport` from a completed job. Returns
 * `not_ready` if the job is still running, `not_found` if the row doesn't
 * exist, and `load` for any other accessor failure.
 */
export function readDiscoveryJobResult(
  args: ReadDiscoveryJobResultArgs,
): ResultAsync<unknown, ReadDiscoveryJobResultError> {
  return args.jobsAccessor
    .readJob(args.jobId)
    .mapErr<ReadDiscoveryJobResultError>((err) =>
      err.type === 'not_found'
        ? { type: 'not_found', message: err.message }
        : { type: 'load', message: err.message },
    )
    .andThen((row) => {
      if (row.status === 'running') {
        return errAsync<unknown, ReadDiscoveryJobResultError>({
          type: 'not_ready',
          message: `Job ${args.jobId} is still running. Poll compliance-discover-status until it completes.`,
        })
      }
      if (row.status === 'failed') {
        return errAsync<unknown, ReadDiscoveryJobResultError>({
          type: 'not_ready',
          message:
            row.error_message ??
            `Job ${args.jobId} failed without a recorded error message.`,
        })
      }
      return okAsync(row.result ?? null)
    })
}
