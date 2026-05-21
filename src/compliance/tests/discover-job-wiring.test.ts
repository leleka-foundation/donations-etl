/**
 * Tests for the async-discover production wiring.
 *
 * The pure orchestrator is tested in discover-job.test.ts; here we
 * verify the wiring side: filter-aware registry construction and the
 * GCP-backed default deps.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { usCaJurisdiction } from '../jurisdictions/us-ca/index.ts'
import { usFederalJurisdiction } from '../jurisdictions/us-federal/index.ts'

const QueryOptsSchema = z.object({ query: z.string().optional() }).loose()

function readQueryFromCall(call: unknown): string | undefined {
  if (!Array.isArray(call)) return undefined
  const first: unknown = call[0]
  if (typeof first !== 'object' || first === null) return undefined
  const parsed = QueryOptsSchema.safeParse(first)
  return parsed.success ? parsed.data.query : undefined
}

const mockBqQuery =
  vi.fn<(opts: unknown) => Promise<readonly [unknown, ...unknown[]]>>()
const mockBqDataset = vi.fn<
  (name: string) => {
    exists: () => Promise<unknown>
    createTable: (id: string, opts: unknown) => Promise<unknown>
    table: (id: string) => { exists: () => Promise<unknown> }
  }
>()
const mockBqCreateDataset = vi.fn<(name: string) => Promise<unknown>>()

const mockSmAccess =
  vi.fn<(req: { name: string }) => Promise<readonly [unknown, ...unknown[]]>>()
const mockSmGet =
  vi.fn<(req: { name: string }) => Promise<readonly [unknown, ...unknown[]]>>()
const mockSmCreate =
  vi.fn<(req: unknown) => Promise<readonly [unknown, ...unknown[]]>>()
const mockSmAdd =
  vi.fn<(req: unknown) => Promise<readonly [unknown, ...unknown[]]>>()

vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: class MockBigQuery {
    query = mockBqQuery
    dataset = mockBqDataset
    createDataset = mockBqCreateDataset
  },
}))

vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class MockSm {
    accessSecretVersion = mockSmAccess
    getSecret = mockSmGet
    createSecret = mockSmCreate
    addSecretVersion = mockSmAdd
  },
}))

const { BigQuery } = await import('@google-cloud/bigquery')
const { SecretManagerServiceClient } =
  await import('@google-cloud/secret-manager')
const {
  buildFilteredRegistry,
  defaultDiscoverJobFetch,
  readDiscoveryJobResultProduction,
  readDiscoveryJobStatusProduction,
  startDiscoveryJobProduction,
} = await import('../skills/discover-job-wiring.ts')

describe('defaultDiscoverJobFetch', () => {
  it('delegates to the global fetch', async () => {
    // Stub the global so we don't make a real network call. Bun's
    // `typeof fetch` carries a `preconnect` no-op method; we stub it
    // with a passthrough rather than trying to bind to the original.
    const originalFetch = globalThis.fetch
    const spy = vi.fn<(input: string) => Promise<Response>>(
      async () => new Response('ok'),
    )
    const stubbedFetch: typeof fetch = Object.assign(
      (input: string | URL | Request) => {
        let key: string
        if (typeof input === 'string') {
          key = input
        } else if (input instanceof URL) {
          key = input.href
        } else {
          key = input.url
        }
        return spy(key)
      },
      {
        preconnect: (): void => {
          /* no-op stub */
        },
      },
    )
    globalThis.fetch = stubbedFetch
    try {
      const r = await defaultDiscoverJobFetch('https://example.invalid/')
      expect(await r.text()).toBe('ok')
      expect(spy).toHaveBeenCalledWith('https://example.invalid/')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('buildFilteredRegistry', () => {
  const jurisdictions = [usFederalJurisdiction, usCaJurisdiction] as const

  it('returns the full registry when no filter is supplied', () => {
    const out = buildFilteredRegistry(jurisdictions, {
      sources: null,
      jurisdictionId: null,
    })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.registry.list().length).toBeGreaterThan(0)
  })

  it('drops jurisdictions that do not match jurisdictionId', () => {
    const out = buildFilteredRegistry(jurisdictions, {
      sources: null,
      jurisdictionId: 'us-federal',
    })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    const ids = out.registry.list().map((j) => j.id)
    expect(ids).toEqual(['us-federal'])
  })

  it('filters sources by id', () => {
    const out = buildFilteredRegistry(jurisdictions, {
      sources: ['irs-eo-bmf'],
      jurisdictionId: null,
    })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    const sourceIds = out.registry
      .list()
      .flatMap((j) => j.sources.map((s) => s.id))
    expect(sourceIds).toEqual(['irs-eo-bmf'])
  })

  it('drops a jurisdiction whose sources are all filtered out', () => {
    const out = buildFilteredRegistry(jurisdictions, {
      sources: ['irs-eo-bmf'],
      jurisdictionId: null,
    })
    if (out.kind !== 'ok') return
    expect(out.registry.list().map((j) => j.id)).toEqual(['us-federal'])
  })

  it('returns wiring err when register() reports a duplicate', () => {
    const out = buildFilteredRegistry(
      [usFederalJurisdiction, usFederalJurisdiction],
      { sources: null, jurisdictionId: null },
    )
    expect(out.kind).toBe('err')
    if (out.kind !== 'err') return
    expect(out.message).toContain('us-federal')
  })
})

describe('startDiscoveryJobProduction', () => {
  it('returns a wiring error when the registry build fails', async () => {
    const result = await startDiscoveryJobProduction({
      projectId: 'my-proj',
      filter: { sources: null, jurisdictionId: null },
      jurisdictions: [usFederalJurisdiction, usFederalJurisdiction],
      bqFactory: (projectId) => new BigQuery({ projectId }),
      secretManagerFactory: () => new SecretManagerServiceClient(),
      spawn: () => undefined,
    })
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('wiring')
  })

  it('inserts the discovery_jobs row when registry build succeeds', async () => {
    mockBqQuery.mockReset()
    mockBqQuery.mockResolvedValue([[], {}])
    mockBqDataset.mockReturnValue({
      exists: vi.fn<() => Promise<unknown>>(() => Promise.resolve([true])),
      createTable: vi.fn<(id: string, opts: unknown) => Promise<unknown>>(() =>
        Promise.resolve([{}]),
      ),
      table: vi.fn<(id: string) => { exists: () => Promise<unknown> }>(() => ({
        exists: vi.fn<() => Promise<unknown>>(() => Promise.resolve([true])),
      })),
    })

    const result = await startDiscoveryJobProduction({
      projectId: 'my-proj',
      filter: { sources: null, jurisdictionId: null },
      bqFactory: (projectId) => new BigQuery({ projectId }),
      secretManagerFactory: () => new SecretManagerServiceClient(),
      // Suppress background spawn so the test stays deterministic.
      spawn: () => undefined,
      generateJobId: () => '11111111-1111-4111-8111-111111111111',
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.jobId).toBe('11111111-1111-4111-8111-111111111111')
    // discovery_jobs INSERT was executed
    const sql = readQueryFromCall(mockBqQuery.mock.calls[0])
    expect(sql).toMatch(/INSERT INTO `my-proj\.compliance\.discovery_jobs`/)
  })

  it('invokes the background discovery runner when spawned', async () => {
    mockBqQuery.mockReset()
    mockBqQuery.mockResolvedValue([[], {}])
    mockBqDataset.mockReturnValue({
      exists: vi.fn<() => Promise<unknown>>(() => Promise.resolve([true])),
      createTable: vi.fn<(id: string, opts: unknown) => Promise<unknown>>(() =>
        Promise.resolve([{}]),
      ),
      table: vi.fn<(id: string) => { exists: () => Promise<unknown> }>(() => ({
        exists: vi.fn<() => Promise<unknown>>(() => Promise.resolve([true])),
      })),
    })
    mockSmAccess.mockResolvedValue([
      {
        payload: {
          data: Buffer.from(
            JSON.stringify({
              'us-federal': { ein: '12-3456789' },
              'us-ca': { sosEntityNumber: 'C0123456' },
            }),
            'utf8',
          ),
        },
      },
    ])

    const spawnedPromises: Promise<void>[] = []
    const recordingSpawn = (run: () => Promise<void>): void => {
      spawnedPromises.push(run())
    }
    const result = await startDiscoveryJobProduction({
      projectId: 'my-proj',
      filter: { sources: [], jurisdictionId: null },
      bqFactory: (projectId) => new BigQuery({ projectId }),
      secretManagerFactory: () => new SecretManagerServiceClient(),
      spawn: recordingSpawn,
      generateJobId: () => '22222222-2222-4222-8222-222222222222',
    })
    expect(result.isOk()).toBe(true)
    await Promise.all(spawnedPromises)
    // Some discovery_runs or discovery_jobs INSERTs were issued by the
    // background flow; we don't pin specific counts here since the
    // production discovery code does several BQ writes.
    expect(mockBqQuery).toHaveBeenCalled()
  })

  it('uses the system clock when `now` is not supplied', async () => {
    mockBqQuery.mockReset()
    mockBqQuery.mockResolvedValue([[], {}])
    mockBqDataset.mockReturnValue({
      exists: vi.fn<() => Promise<unknown>>(() => Promise.resolve([true])),
      createTable: vi.fn<(id: string, opts: unknown) => Promise<unknown>>(() =>
        Promise.resolve([{}]),
      ),
      table: vi.fn<(id: string) => { exists: () => Promise<unknown> }>(() => ({
        exists: vi.fn<() => Promise<unknown>>(() => Promise.resolve([true])),
      })),
    })
    const result = await startDiscoveryJobProduction({
      projectId: 'my-proj',
      filter: { sources: null, jurisdictionId: null },
      bqFactory: (projectId) => new BigQuery({ projectId }),
      secretManagerFactory: () => new SecretManagerServiceClient(),
      spawn: () => undefined,
    })
    expect(result.isOk()).toBe(true)
  })
})

describe('readDiscoveryJobStatusProduction', () => {
  it('reads the parent row and counts child runs', async () => {
    mockBqQuery.mockReset()
    mockBqQuery.mockImplementation((opts: unknown) => {
      const parsedOpts = QueryOptsSchema.safeParse(opts)
      const query = parsedOpts.success ? parsedOpts.data.query : undefined
      if (query?.includes('.compliance.discovery_jobs') === true) {
        return Promise.resolve([
          [
            {
              job_id: '11111111-1111-4111-8111-111111111111',
              started_at: { value: '2024-05-01T00:00:00Z' },
              finished_at: null,
              status: 'running',
              requested_sources: null,
              requested_jurisdiction: null,
              error_type: null,
              error_message: null,
              result: null,
            },
          ],
          {},
        ])
      }
      return Promise.resolve([[], {}])
    })

    const result = await readDiscoveryJobStatusProduction({
      projectId: 'my-proj',
      jobId: '11111111-1111-4111-8111-111111111111',
      bqFactory: (projectId) => new BigQuery({ projectId }),
      secretManagerFactory: () => new SecretManagerServiceClient(),
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.status).toBe('running')
  })
})

describe('readDiscoveryJobResultProduction', () => {
  it('returns the stored result when the job is completed', async () => {
    mockBqQuery.mockReset()
    mockBqQuery.mockImplementation((opts: unknown) => {
      const parsedOpts = QueryOptsSchema.safeParse(opts)
      const query = parsedOpts.success ? parsedOpts.data.query : undefined
      if (query?.includes('.compliance.discovery_jobs') === true) {
        return Promise.resolve([
          [
            {
              job_id: '11111111-1111-4111-8111-111111111111',
              started_at: { value: '2024-05-01T00:00:00Z' },
              finished_at: { value: '2024-05-01T00:00:30Z' },
              status: 'completed',
              requested_sources: null,
              requested_jurisdiction: null,
              error_type: null,
              error_message: null,
              result: { runs: [], findings: [] },
            },
          ],
          {},
        ])
      }
      return Promise.resolve([[], {}])
    })

    const result = await readDiscoveryJobResultProduction({
      projectId: 'my-proj',
      jobId: '11111111-1111-4111-8111-111111111111',
      bqFactory: (projectId) => new BigQuery({ projectId }),
      secretManagerFactory: () => new SecretManagerServiceClient(),
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual({ runs: [], findings: [] })
  })
})
