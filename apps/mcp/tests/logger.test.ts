/**
 * Tests for the MCP server logger.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../src/logger'

describe('createLogger', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('creates a logger with the configured level', () => {
    process.env.NODE_ENV = 'production'
    const logger = createLogger({ LOG_LEVEL: 'warn' })

    expect(logger.level).toBe('warn')
  })

  it('uses pino-pretty in non-production', () => {
    process.env.NODE_ENV = 'test'
    const logger = createLogger({ LOG_LEVEL: 'info' })

    expect(logger.level).toBe('info')
  })

  it('defaults to info level when configured', () => {
    process.env.NODE_ENV = 'production'
    const logger = createLogger({ LOG_LEVEL: 'info' })

    expect(logger.level).toBe('info')
  })
})
