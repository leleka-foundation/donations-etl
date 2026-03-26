/**
 * Structured logging using pino.
 */
import pino from 'pino'
import type { Config } from './config'

/**
 * Create a configured logger.
 */
export function createLogger(config: Config): pino.Logger {
  return pino({
    level: config.LOG_LEVEL,
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          }
        : undefined,
  })
}

/**
 * Child logger type for typed logging.
 */
export type Logger = pino.Logger
