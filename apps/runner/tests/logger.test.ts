/**
 * Tests for logger creation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config'
import { createLogger } from '../src/logger'

describe('createLogger', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const baseConfig: Config = {
    PROJECT_ID: 'test-project',
    BUCKET: 'test-bucket',
    DATASET_RAW: 'donations_raw',
    DATASET_CANON: 'donations',
    LOOKBACK_HOURS: 48,
    LOG_LEVEL: 'info',
    CHECK_DEPOSITS_SHEET_NAME: 'checks',
  }

  it('creates a logger with the specified log level', () => {
    const config: Config = { ...baseConfig, LOG_LEVEL: 'debug' }

    const logger = createLogger(config)

    expect(logger).toBeDefined()
    expect(logger.level).toBe('debug')
  })

  it('creates a logger with info level', () => {
    const config: Config = { ...baseConfig, LOG_LEVEL: 'info' }

    const logger = createLogger(config)

    expect(logger.level).toBe('info')
  })

  it('creates a logger with warn level', () => {
    const config: Config = { ...baseConfig, LOG_LEVEL: 'warn' }

    const logger = createLogger(config)

    expect(logger.level).toBe('warn')
  })

  it('creates a logger with error level', () => {
    const config: Config = { ...baseConfig, LOG_LEVEL: 'error' }

    const logger = createLogger(config)

    expect(logger.level).toBe('error')
  })

  it('uses pino-pretty transport in non-production', () => {
    process.env.NODE_ENV = 'development'
    const config: Config = { ...baseConfig }

    // Just verify it doesn't throw - transport config is internal
    const logger = createLogger(config)

    expect(logger).toBeDefined()
  })

  it('does not use pino-pretty transport in production', () => {
    process.env.NODE_ENV = 'production'
    const config: Config = { ...baseConfig }

    const logger = createLogger(config)

    expect(logger).toBeDefined()
  })

  it('logger has expected methods', () => {
    const config: Config = { ...baseConfig }

    const logger = createLogger(config)

    expect(typeof logger.info).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.child).toBe('function')
  })
})
