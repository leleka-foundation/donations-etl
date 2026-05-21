/**
 * Tests for the compliance-discover-start / -status / -result MCP tool
 * handlers.
 */
import { errAsync, okAsync } from 'neverthrow'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type {
  DiscoveryJobFilter,
  DiscoveryJobStatusReport,
  StartDiscoveryJobReport,
} from '../../../../src/compliance/skills/discover-job.ts'
import type { FirestoreClientLike } from '../../../../src/compliance/state/firestore-jobs.ts'
import type { Config } from '../../src/config'

function makeFakeFirestore(): FirestoreClientLike {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    doc(path: string) {
      return {
        get(): Promise<{
          exists: boolean
          data(): Record<string, unknown> | undefined
        }> {
          const data = docs.get(path)
          return Promise.resolve({
            exists: data !== undefined,
            data: () => data,
          })
        },
        set(data: Record<string, unknown>): Promise<unknown> {
          docs.set(path, data)
          return Promise.resolve()
        },
        update(patch: Record<string, unknown>): Promise<unknown> {
          docs.set(path, { ...(docs.get(path) ?? {}), ...patch })
          return Promise.resolve()
        },
      }
    },
  }
}

import {
  defaultDiscoverResultRunner,
  defaultDiscoverStartRunner,
  defaultDiscoverStatusRunner,
  handleComplianceDiscoverResult,
  handleComplianceDiscoverStart,
  handleComplianceDiscoverStatus,
  resolveDiscoverResultRunner,
  resolveDiscoverStartRunner,
  resolveDiscoverStatusRunner,
  toJobFilter,
  translateResultError,
  translateStartError,
  translateStatusError,
  type DiscoverResultRunner,
  type DiscoverStartRunner,
  type DiscoverStatusRunner,
} from '../../src/tools/compliance/discover'

const testConfig: Config = {
  PORT: 8080,
  LOG_LEVEL: 'info' as const,
  PROJECT_ID: 'test-project',
  DATASET_CANON: 'donations',
  GOOGLE_CLIENT_ID: 'test-client-id',
  BASE_URL: 'https://mcp.example.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  MCP_ALLOWED_DOMAIN: 'example.com',
  ORG_NAME: 'Test Org',
  ORG_ADDRESS: '123 Main St',
  ORG_MISSION: 'Test mission',
  ORG_TAX_STATUS: 'Test tax status',
  DEFAULT_SIGNER_NAME: 'Jane Doe',
  DEFAULT_SIGNER_TITLE: 'President',
}

const logger = pino({ level: 'silent' })

const JOB_ID = '11111111-1111-4111-8111-111111111111'

const START_REPORT: StartDiscoveryJobReport = { jobId: JOB_ID }

const STATUS_REPORT: DiscoveryJobStatusReport = {
  jobId: JOB_ID,
  status: 'completed',
  startedAt: '2024-05-01T00:00:00Z',
  finishedAt: '2024-05-01T00:00:30Z',
  requestedSources: null,
  requestedJurisdiction: null,
  completedSourceCount: 3,
  errorType: null,
  errorMessage: null,
}

describe('toJobFilter', () => {
  it('defaults missing fields to null', () => {
    const filter: DiscoveryJobFilter = toJobFilter({})
    expect(filter).toEqual({ sources: null, jurisdictionId: null })
  })

  it('preserves both fields when supplied', () => {
    expect(
      toJobFilter({ sources: ['irs-teos'], jurisdictionId: 'us-federal' }),
    ).toEqual({ sources: ['irs-teos'], jurisdictionId: 'us-federal' })
  })

  it('preserves only the supplied field', () => {
    expect(toJobFilter({ sources: ['irs-teos'] })).toEqual({
      sources: ['irs-teos'],
      jurisdictionId: null,
    })
    expect(toJobFilter({ jurisdictionId: 'us-ca' })).toEqual({
      sources: null,
      jurisdictionId: 'us-ca',
    })
  })
})

describe('handleComplianceDiscoverStart', () => {
  it('refuses without confirm:true', async () => {
    const runner = vi.fn<DiscoverStartRunner>(() => okAsync(START_REPORT))
    const result = await handleComplianceDiscoverStart(
      { confirm: false },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStart: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('unconfirmed')
    expect(runner).not.toHaveBeenCalled()
  })

  it('starts a job when confirmed', async () => {
    const runner = vi.fn<DiscoverStartRunner>(() => okAsync(START_REPORT))
    const result = await handleComplianceDiscoverStart(
      { confirm: true, sources: ['irs-teos'] },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStart: runner,
      },
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.jobId).toBe(JOB_ID)
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'test-project',
        filter: { sources: ['irs-teos'], jurisdictionId: null },
      }),
    )
  })

  it('surfaces a persist error from the runner', async () => {
    const runner = vi.fn<DiscoverStartRunner>(() =>
      errAsync({ type: 'persist' as const, message: 'BQ down' }),
    )
    const result = await handleComplianceDiscoverStart(
      { confirm: true },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStart: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('persist')
  })

  it('surfaces a wiring error from the runner', async () => {
    const runner = vi.fn<DiscoverStartRunner>(() =>
      errAsync({ type: 'wiring' as const, message: 'reg conflict' }),
    )
    const result = await handleComplianceDiscoverStart(
      { confirm: true },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStart: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('wiring')
  })
})

describe('handleComplianceDiscoverStatus', () => {
  it('returns the status report from the runner', async () => {
    const runner = vi.fn<DiscoverStatusRunner>(() => okAsync(STATUS_REPORT))
    const result = await handleComplianceDiscoverStatus(
      { jobId: JOB_ID },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStatus: runner,
      },
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.completedSourceCount).toBe(3)
  })

  it('surfaces a not_found error', async () => {
    const runner = vi.fn<DiscoverStatusRunner>(() =>
      errAsync({ type: 'not_found' as const, message: 'unknown job' }),
    )
    const result = await handleComplianceDiscoverStatus(
      { jobId: 'missing' },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStatus: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('not_found')
  })

  it('surfaces a load error', async () => {
    const runner = vi.fn<DiscoverStatusRunner>(() =>
      errAsync({ type: 'load' as const, message: 'BQ down' }),
    )
    const result = await handleComplianceDiscoverStatus(
      { jobId: JOB_ID },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverStatus: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('load')
  })
})

describe('handleComplianceDiscoverResult', () => {
  it('returns the stored report when the runner succeeds', async () => {
    const REPORT = { runs: [], findings: [] }
    const runner = vi.fn<DiscoverResultRunner>(() => okAsync(REPORT))
    const result = await handleComplianceDiscoverResult(
      { jobId: JOB_ID },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverResult: runner,
      },
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual(REPORT)
  })

  it('surfaces a not_ready error when the job has not completed', async () => {
    const runner = vi.fn<DiscoverResultRunner>(() =>
      errAsync({
        type: 'not_ready' as const,
        message: 'still running',
      }),
    )
    const result = await handleComplianceDiscoverResult(
      { jobId: JOB_ID },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverResult: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('not_ready')
  })

  it('surfaces a not_found error', async () => {
    const runner = vi.fn<DiscoverResultRunner>(() =>
      errAsync({ type: 'not_found' as const, message: 'gone' }),
    )
    const result = await handleComplianceDiscoverResult(
      { jobId: 'missing' },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverResult: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('not_found')
  })

  it('surfaces a load error', async () => {
    const runner = vi.fn<DiscoverResultRunner>(() =>
      errAsync({ type: 'load' as const, message: 'BQ down' }),
    )
    const result = await handleComplianceDiscoverResult(
      { jobId: JOB_ID },
      {
        config: testConfig,
        logger,
        firestore: makeFakeFirestore(),
        runDiscoverResult: runner,
      },
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('load')
  })
})

describe('translateStartError / translateStatusError / translateResultError', () => {
  it('preserves the type and message', () => {
    expect(translateStartError({ type: 'persist', message: 'x' })).toEqual({
      type: 'persist',
      message: 'x',
    })
    expect(translateStartError({ type: 'wiring', message: 'x' })).toEqual({
      type: 'wiring',
      message: 'x',
    })
    expect(translateStatusError({ type: 'not_found', message: 'x' })).toEqual({
      type: 'not_found',
      message: 'x',
    })
    expect(translateStatusError({ type: 'load', message: 'x' })).toEqual({
      type: 'load',
      message: 'x',
    })
    expect(translateResultError({ type: 'not_ready', message: 'x' })).toEqual({
      type: 'not_ready',
      message: 'x',
    })
    expect(translateResultError({ type: 'not_found', message: 'x' })).toEqual({
      type: 'not_found',
      message: 'x',
    })
    expect(translateResultError({ type: 'load', message: 'x' })).toEqual({
      type: 'load',
      message: 'x',
    })
  })
})

describe('default discover runners', () => {
  it('are callable functions that return ResultAsync values', () => {
    expect(typeof defaultDiscoverStartRunner).toBe('function')
    expect(typeof defaultDiscoverStatusRunner).toBe('function')
    expect(typeof defaultDiscoverResultRunner).toBe('function')
    const firestore = makeFakeFirestore()
    const start = defaultDiscoverStartRunner({
      projectId: 'test-project',
      filter: { sources: null, jurisdictionId: null },
      firestore,
    })
    expect(typeof start.match).toBe('function')
    const status = defaultDiscoverStatusRunner({
      projectId: 'test-project',
      jobId: JOB_ID,
      firestore,
    })
    expect(typeof status.match).toBe('function')
    const out = defaultDiscoverResultRunner({
      projectId: 'test-project',
      jobId: JOB_ID,
      firestore,
    })
    expect(typeof out.match).toBe('function')
  })
})

describe('resolve discover runners', () => {
  it('returns the supplied runner / falls back to default', () => {
    const startCustom = vi.fn<DiscoverStartRunner>(() => okAsync(START_REPORT))
    expect(resolveDiscoverStartRunner(startCustom)).toBe(startCustom)
    expect(resolveDiscoverStartRunner()).toBe(defaultDiscoverStartRunner)
    expect(resolveDiscoverStartRunner(undefined)).toBe(
      defaultDiscoverStartRunner,
    )

    const statusCustom = vi.fn<DiscoverStatusRunner>(() =>
      okAsync(STATUS_REPORT),
    )
    expect(resolveDiscoverStatusRunner(statusCustom)).toBe(statusCustom)
    expect(resolveDiscoverStatusRunner()).toBe(defaultDiscoverStatusRunner)
    expect(resolveDiscoverStatusRunner(undefined)).toBe(
      defaultDiscoverStatusRunner,
    )

    const resultCustom = vi.fn<DiscoverResultRunner>(() => okAsync(null))
    expect(resolveDiscoverResultRunner(resultCustom)).toBe(resultCustom)
    expect(resolveDiscoverResultRunner()).toBe(defaultDiscoverResultRunner)
    expect(resolveDiscoverResultRunner(undefined)).toBe(
      defaultDiscoverResultRunner,
    )
  })
})
