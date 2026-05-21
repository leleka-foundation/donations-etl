/**
 * Production wiring for the async compliance-discover job flow.
 *
 * `startDiscoveryJobProduction` mirrors `runDiscoveryProduction` (which the
 * synchronous local skill uses) but wraps the discovery call in the
 * job-control orchestrator from `discover-job.ts`. The actual discovery
 * runs fire-and-forget; the caller polls via
 * `readDiscoveryJobStatusProduction` and fetches the report with
 * `readDiscoveryJobResultProduction`.
 */
import type { ResultAsync } from 'neverthrow'
import { errAsync } from 'neverthrow'
import { join } from 'node:path'
import { usCaJurisdiction } from '../jurisdictions/us-ca/index.ts'
import { usFederalJurisdiction } from '../jurisdictions/us-federal/index.ts'
import {
  createJurisdictionRegistry,
  type JurisdictionRegistry,
} from '../registry/jurisdiction-registry.ts'
import {
  LocalDownloadCacheStore,
  type DownloadCacheStore,
} from '../sources/download-cache.ts'
import { createFindingsAccessor } from '../state/bq-findings.ts'
import { createDiscoveryJobsAccessor } from '../state/bq-jobs.ts'
import { createDiscoveryRunsAccessor } from '../state/bq-runs.ts'
import type { FetchImpl, Jurisdiction } from '../types/index.ts'
import {
  readDiscoveryJobResult,
  readDiscoveryJobStatus,
  startDiscoveryJob,
  voidSpawn,
  type DiscoveryJobFilter,
  type DiscoveryJobStatusReport,
  type ReadDiscoveryJobResultError,
  type ReadDiscoveryJobStatusError,
  type SpawnDiscoveryJob,
  type StartDiscoveryJobError,
  type StartDiscoveryJobReport,
} from './discover-job.ts'
import { runDiscovery } from './discover.ts'
import {
  buildCommonDeps,
  type BigQueryFactory,
  type SecretManagerFactory,
} from './wiring-common.ts'

/**
 * Top-level error a production caller may see when starting a job. Includes
 * the underlying persist error plus a `wiring` case that fires only on
 * jurisdiction registration conflicts (typically: two jurisdictions with
 * the same id).
 */
export type StartDiscoveryJobProductionError =
  | StartDiscoveryJobError
  | { readonly type: 'wiring'; readonly message: string }

/**
 * Wiring args for the production start entry point.
 */
export interface StartDiscoveryJobProductionArgs {
  readonly projectId: string
  readonly filter: DiscoveryJobFilter
  readonly bqFactory?: BigQueryFactory
  readonly secretManagerFactory?: SecretManagerFactory
  readonly now?: () => Date
  readonly fetch?: FetchImpl
  readonly jurisdictions?: readonly Jurisdiction[]
  readonly downloadCache?: DownloadCacheStore
  readonly downloadCacheDir?: string
  readonly spawn?: SpawnDiscoveryJob
  readonly generateJobId?: () => string
  readonly logger?: { error: (message: string, err: unknown) => void }
}

/**
 * Start an async discover job against real GCP services. Returns
 * `{ jobId }` once the parent row is inserted; the actual sourcing runs
 * in the background and updates the row when it finishes.
 */
export function startDiscoveryJobProduction(
  args: StartDiscoveryJobProductionArgs,
): ResultAsync<StartDiscoveryJobReport, StartDiscoveryJobProductionError> {
  const now = args.now ?? (() => new Date())
  const fetchImpl: FetchImpl =
    args.fetch ?? ((input, init) => fetch(input, init))
  const jurisdictions = args.jurisdictions ?? [
    usFederalJurisdiction,
    usCaJurisdiction,
  ]
  const downloadCache =
    args.downloadCache ??
    new LocalDownloadCacheStore(
      args.downloadCacheDir ?? join(process.cwd(), '.cache', 'compliance'),
    )

  const registryResult = buildFilteredRegistry(jurisdictions, args.filter)
  if (registryResult.kind === 'err') {
    return errAsync<StartDiscoveryJobReport, StartDiscoveryJobProductionError>({
      type: 'wiring',
      message: registryResult.message,
    })
  }

  const deps = buildCommonDeps({
    projectId: args.projectId,
    now,
    bqFactory: args.bqFactory,
    secretManagerFactory: args.secretManagerFactory,
  })
  const jobsAccessor = createDiscoveryJobsAccessor({
    runner: deps.queryRunner,
    projectId: args.projectId,
  })
  const runsAccessor = createDiscoveryRunsAccessor({
    runner: deps.queryRunner,
    projectId: args.projectId,
  })
  const findingsAccessor = createFindingsAccessor({
    runner: deps.queryRunner,
    projectId: args.projectId,
  })

  return startDiscoveryJob({
    jobsAccessor,
    runsAccessor,
    findingsAccessor,
    now,
    filter: args.filter,
    runDiscovery: ({ recorder }) =>
      runDiscovery({
        registry: registryResult.registry,
        entityAccessor: deps.entityAccessor,
        identifiersAccessor: deps.identifiersAccessor,
        recorder,
        migrationPort: deps.migrationPort,
        now,
        fetch: fetchImpl,
        downloadCache,
      }),
    spawn: args.spawn ?? voidSpawn,
    generateJobId: args.generateJobId,
    logger: args.logger,
  })
}

/**
 * Wiring args for the production status entry point.
 */
export interface ReadDiscoveryJobStatusProductionArgs {
  readonly projectId: string
  readonly jobId: string
  readonly bqFactory?: BigQueryFactory
  readonly secretManagerFactory?: SecretManagerFactory
  readonly now?: () => Date
}

/**
 * Read job status against real GCP services.
 */
export function readDiscoveryJobStatusProduction(
  args: ReadDiscoveryJobStatusProductionArgs,
): ResultAsync<DiscoveryJobStatusReport, ReadDiscoveryJobStatusError> {
  const now = args.now ?? (() => new Date())
  const deps = buildCommonDeps({
    projectId: args.projectId,
    now,
    bqFactory: args.bqFactory,
    secretManagerFactory: args.secretManagerFactory,
  })
  return readDiscoveryJobStatus({
    jobsAccessor: createDiscoveryJobsAccessor({
      runner: deps.queryRunner,
      projectId: args.projectId,
    }),
    runsAccessor: createDiscoveryRunsAccessor({
      runner: deps.queryRunner,
      projectId: args.projectId,
    }),
    jobId: args.jobId,
  })
}

/**
 * Wiring args for the production result entry point.
 */
export interface ReadDiscoveryJobResultProductionArgs {
  readonly projectId: string
  readonly jobId: string
  readonly bqFactory?: BigQueryFactory
  readonly secretManagerFactory?: SecretManagerFactory
  readonly now?: () => Date
}

/**
 * Read the completed job's result against real GCP services.
 */
export function readDiscoveryJobResultProduction(
  args: ReadDiscoveryJobResultProductionArgs,
): ResultAsync<unknown, ReadDiscoveryJobResultError> {
  const now = args.now ?? (() => new Date())
  const deps = buildCommonDeps({
    projectId: args.projectId,
    now,
    bqFactory: args.bqFactory,
    secretManagerFactory: args.secretManagerFactory,
  })
  return readDiscoveryJobResult({
    jobsAccessor: createDiscoveryJobsAccessor({
      runner: deps.queryRunner,
      projectId: args.projectId,
    }),
    jobId: args.jobId,
  })
}

type FilteredRegistryResult =
  | { kind: 'ok'; registry: JurisdictionRegistry }
  | { kind: 'err'; message: string }

/**
 * Build a JurisdictionRegistry, optionally filtered by jurisdictionId and/or
 * sources. The filter is applied before registration so the discovery loop
 * iterates only the sources the caller asked for.
 */
export function buildFilteredRegistry(
  list: readonly Jurisdiction[],
  filter: DiscoveryJobFilter,
): FilteredRegistryResult {
  const registry = createJurisdictionRegistry()
  const sourceFilter = filter.sources === null ? null : new Set(filter.sources)
  for (const j of list) {
    if (filter.jurisdictionId !== null && j.id !== filter.jurisdictionId) {
      continue
    }
    const filteredSources =
      sourceFilter === null
        ? j.sources
        : j.sources.filter((s) => sourceFilter.has(s.id))
    if (filteredSources.length === 0) {
      continue
    }
    const filteredJurisdiction: Jurisdiction = {
      ...j,
      sources: filteredSources,
    }
    const r = registry.register(filteredJurisdiction)
    if (r.isErr()) {
      return {
        kind: 'err',
        message: `Failed to register jurisdiction "${r.error.id}": ${r.error.message}`,
      }
    }
  }
  return { kind: 'ok', registry }
}
