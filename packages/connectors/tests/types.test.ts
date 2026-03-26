import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import type {
  Connector,
  FetchOptions,
  FetchResult,
  GivebutterConfig,
  MercuryConfig,
  PayPalConfig,
} from '../src/types'

describe('FetchOptions', () => {
  it('can create valid fetch options', () => {
    const options: FetchOptions = {
      from: DateTime.fromISO('2024-01-01T00:00:00Z', { zone: 'utc' }),
      to: DateTime.fromISO('2024-01-31T23:59:59Z', { zone: 'utc' }),
      runId: '550e8400-e29b-41d4-a716-446655440000',
    }

    expect(options.from.toUTC().toISO()).toBe('2024-01-01T00:00:00.000Z')
    expect(options.to.toUTC().toISO()).toBe('2024-01-31T23:59:59.000Z')
    expect(options.runId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})

describe('FetchResult', () => {
  it('can create result with events and no more pages', () => {
    const result: FetchResult = {
      events: [],
      hasMore: false,
    }

    expect(result.events).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
  })

  it('can create result with events and more pages', () => {
    const result: FetchResult = {
      events: [],
      hasMore: true,
      nextCursor: 'cursor_123',
    }

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('cursor_123')
  })
})

describe('ConnectorConfigs', () => {
  it('can create Mercury config', () => {
    const config: MercuryConfig = {
      apiKey: 'test_key',
      baseUrl: 'https://api.mercury.com',
    }

    expect(config.apiKey).toBe('test_key')
    expect(config.baseUrl).toBe('https://api.mercury.com')
  })

  it('can create Mercury config without optional baseUrl', () => {
    const config: MercuryConfig = {
      apiKey: 'test_key',
    }

    expect(config.apiKey).toBe('test_key')
    expect(config.baseUrl).toBeUndefined()
  })

  it('can create PayPal config', () => {
    const config: PayPalConfig = {
      clientId: 'client_123',
      secret: 'secret_456',
    }

    expect(config.clientId).toBe('client_123')
    expect(config.secret).toBe('secret_456')
  })

  it('can create Givebutter config', () => {
    const config: GivebutterConfig = {
      apiKey: 'gb_test_key',
    }

    expect(config.apiKey).toBe('gb_test_key')
  })
})

describe('Connector interface', () => {
  it('has required properties and methods defined in the type', () => {
    // This is a type-level test - we verify the interface structure
    // by creating a mock that satisfies it
    const mockConnector: Connector = {
      source: 'mercury',
      fetchAll: () => {
        throw new Error('Not implemented')
      },
      fetchPage: () => {
        throw new Error('Not implemented')
      },
      healthCheck: () => {
        throw new Error('Not implemented')
      },
    }

    expect(mockConnector.source).toBe('mercury')
    expect(typeof mockConnector.fetchAll).toBe('function')
    expect(typeof mockConnector.fetchPage).toBe('function')
    expect(typeof mockConnector.healthCheck).toBe('function')
  })
})
