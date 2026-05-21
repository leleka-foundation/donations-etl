/**
 * Tests for the compliance-status MCP tool handler.
 */
import { errAsync, okAsync } from 'neverthrow'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { ComplianceStatusReport } from '../../../../src/compliance/skills/status.ts'
import type { Config } from '../../src/config'
import {
  defaultComplianceStatusReader,
  handleComplianceStatus,
  resolveStatusReader,
} from '../../src/tools/compliance/status'

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

const STUB_REPORT: ComplianceStatusReport = {
  entity: {
    legal_name: 'Foo',
    state_of_incorporation: 'CA',
    fiscal_year_end_month: 12,
    fiscal_year_end_day: 31,
    formation_date: '2010-01-15',
    mailing_address_line1: '1 Mission St',
    mailing_address_line2: null,
    mailing_address_city: 'San Francisco',
    mailing_address_region: 'CA',
    mailing_address_postal_code: '94105',
    mailing_address_country: 'US',
    updated_at: '2024-05-01T00:00:00Z',
  },
  identifiers: {
    'us-federal': { ein: '12-3456789' },
    'us-ca': { sosEntityNumber: 'C0123456' },
  },
  latestRuns: [],
  openFindings: [],
  overall: 'clear',
}

const mockLogger = pino({ level: 'silent' })

describe('handleComplianceStatus', () => {
  it('returns the production report when the reader succeeds', async () => {
    const reader = vi.fn(() => okAsync(STUB_REPORT))
    const result = await handleComplianceStatus({
      config: testConfig,
      logger: mockLogger,
      readStatus: reader,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.overall).toBe('clear')
    expect(reader).toHaveBeenCalledWith('test-project')
  })

  it('surfaces a not_onboarded error from the reader', async () => {
    const reader = vi.fn(() =>
      errAsync({
        type: 'not_onboarded' as const,
        message: 'onboard first',
      }),
    )
    const result = await handleComplianceStatus({
      config: testConfig,
      logger: mockLogger,
      readStatus: reader,
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('not_onboarded')
    expect(result.error.message).toContain('onboard first')
  })

  it('surfaces a load error from the reader', async () => {
    const reader = vi.fn(() =>
      errAsync({
        type: 'load' as const,
        message: 'BQ down',
      }),
    )
    const result = await handleComplianceStatus({
      config: testConfig,
      logger: mockLogger,
      readStatus: reader,
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.type).toBe('load')
  })
})

describe('defaultComplianceStatusReader', () => {
  it('is a function that adapts the production wiring', () => {
    // The wiring itself is exercised under status-wiring.test.ts. Here we
    // verify the adapter exists and is callable with a project id. We do
    // not await — invoking the GCP-backed wiring requires real creds.
    expect(typeof defaultComplianceStatusReader).toBe('function')
    const out = defaultComplianceStatusReader('test-project')
    expect(typeof out.match).toBe('function')
  })
})

describe('resolveStatusReader', () => {
  it('returns the supplied reader when one is provided', () => {
    const custom = vi.fn(() => okAsync(STUB_REPORT))
    expect(resolveStatusReader(custom)).toBe(custom)
  })

  it('falls back to the production default when no reader is supplied', () => {
    expect(resolveStatusReader()).toBe(defaultComplianceStatusReader)
  })

  it('falls back to the production default when undefined is passed', () => {
    expect(resolveStatusReader(undefined)).toBe(defaultComplianceStatusReader)
  })
})
