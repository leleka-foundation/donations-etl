/**
 * Tests for the query-donations MCP tool handler.
 */
import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable local/require-typed-vi-fn -- types inferred via vi.mocked() below */
vi.mock('@donations-etl/bq', () => ({
  BigQueryClient: class MockBigQueryClient {
    executeReadOnlyQuery = vi.fn()
  },
  buildQueryFn: vi.fn(),
  runDonationAgent: vi.fn(),
}))
/* eslint-enable local/require-typed-vi-fn */

const { buildQueryFn, runDonationAgent } = await import('@donations-etl/bq')
const { handleQueryDonations } = await import('../src/tools/query-donations')

const mockRunDonationAgent = vi.mocked(runDonationAgent)
const mockBuildQueryFn = vi.mocked(buildQueryFn)

const mockLogger = pino({ level: 'silent' })

const testConfig = {
  PORT: 8080,
  LOG_LEVEL: 'info' as const,
  PROJECT_ID: 'test-project',
  DATASET_CANON: 'donations',
  GOOGLE_CLIENT_ID: 'test-client-id',
  MCP_ALLOWED_DOMAIN: 'example.com',
  ORG_NAME: 'Test Org',
  ORG_ADDRESS: '123 Main St',
  ORG_MISSION: 'Test mission',
  ORG_TAX_STATUS: 'Test tax status',
  DEFAULT_SIGNER_NAME: 'Jane Doe',
  DEFAULT_SIGNER_TITLE: 'President',
}

describe('handleQueryDonations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // eslint-disable-next-line local/require-typed-vi-fn -- mock query function
    mockBuildQueryFn.mockReturnValue(vi.fn())
  })

  it('returns agent result with text and sql', async () => {
    const { okAsync } = await import('neverthrow')
    mockRunDonationAgent.mockReturnValue(
      okAsync({ text: '*$1,500* total donations', sql: 'SELECT ...' }),
    )

    const result = await handleQueryDonations(
      { question: 'How much did we raise?' },
      { config: testConfig, logger: mockLogger },
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.text).toBe('*$1,500* total donations')
      expect(result.value.sql).toBe('SELECT ...')
    }
  })

  it('passes correct BigQuery config to runDonationAgent', async () => {
    const { okAsync } = await import('neverthrow')
    mockRunDonationAgent.mockReturnValue(okAsync({ text: 'answer', sql: null }))

    await handleQueryDonations(
      { question: 'test' },
      { config: testConfig, logger: mockLogger },
    )

    expect(mockRunDonationAgent).toHaveBeenCalledWith(
      'test',
      {
        projectId: 'test-project',
        datasetRaw: '',
        datasetCanon: 'donations',
      },
      expect.any(Function),
      undefined,
      expect.any(Object),
    )
  })

  it('passes agent options from config', async () => {
    const { okAsync } = await import('neverthrow')
    mockRunDonationAgent.mockReturnValue(okAsync({ text: 'answer', sql: null }))

    const configWithAI = {
      ...testConfig,
      AGENT_MODEL: 'gemini-pro',
      GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
    }

    await handleQueryDonations(
      { question: 'test' },
      { config: configWithAI, logger: mockLogger },
    )

    expect(mockRunDonationAgent).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ projectId: 'test-project' }),
      expect.any(Function),
      undefined,
      {
        model: 'gemini-pro',
        orgName: 'Test Org',
        apiKey: 'test-key',
      },
    )
  })

  it('returns error Result on agent failure', async () => {
    const { errAsync } = await import('neverthrow')
    mockRunDonationAgent.mockReturnValue(
      errAsync({ type: 'agent' as const, message: 'Agent failed: timeout' }),
    )

    const result = await handleQueryDonations(
      { question: 'test' },
      { config: testConfig, logger: mockLogger },
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toBe('Agent failed: timeout')
    }
  })

  it('handles null sql in result', async () => {
    const { okAsync } = await import('neverthrow')
    mockRunDonationAgent.mockReturnValue(
      okAsync({ text: 'No data found', sql: null }),
    )

    const result = await handleQueryDonations(
      { question: 'test' },
      { config: testConfig, logger: mockLogger },
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.sql).toBeNull()
    }
  })

  it('returns ok result for valid question', async () => {
    const { okAsync } = await import('neverthrow')
    mockRunDonationAgent.mockReturnValue(okAsync({ text: 'answer', sql: null }))

    const result = await handleQueryDonations(
      { question: 'How many donors?' },
      { config: testConfig, logger: mockLogger },
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual({ text: 'answer', sql: null })
    }
  })
})
