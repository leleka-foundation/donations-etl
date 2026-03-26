/**
 * Tests for CLI parsing.
 */
import { describe, expect, it } from 'vitest'
import {
  BackfillOptionsSchema,
  createCli,
  DailyOptionsSchema,
  noop,
  parseCli,
} from '../src/cli'

describe('noop', () => {
  it('does nothing (Commander action placeholder)', () => {
    expect(noop()).toBeUndefined()
  })
})

describe('DailyOptionsSchema', () => {
  it('parses empty options', () => {
    const result = DailyOptionsSchema.parse({})

    expect(result).toEqual({})
  })

  it('parses options with sources', () => {
    const result = DailyOptionsSchema.parse({
      sources: ['mercury', 'paypal'],
    })

    expect(result.sources).toEqual(['mercury', 'paypal'])
  })

  it('validates source values', () => {
    expect(() =>
      DailyOptionsSchema.parse({
        sources: ['mercury', 'invalid'],
      }),
    ).toThrow()
  })

  it('parses skipMerge option', () => {
    const result = DailyOptionsSchema.parse({
      skipMerge: true,
    })

    expect(result.skipMerge).toBe(true)
  })

  it('parses mergeOnly option', () => {
    const result = DailyOptionsSchema.parse({
      mergeOnly: true,
    })

    expect(result.mergeOnly).toBe(true)
  })

  it('rejects skipMerge and mergeOnly together', () => {
    expect(() =>
      DailyOptionsSchema.parse({
        skipMerge: true,
        mergeOnly: true,
      }),
    ).toThrow('Cannot use --skip-merge and --merge-only together')
  })
})

describe('BackfillOptionsSchema', () => {
  it('parses valid options', () => {
    const result = BackfillOptionsSchema.parse({
      from: '2024-01-01',
      to: '2024-12-31',
      chunk: 'month',
    })

    expect(result.from).toBe('2024-01-01')
    expect(result.to).toBe('2024-12-31')
    expect(result.chunk).toBe('month')
  })

  it('defaults chunk to month', () => {
    const result = BackfillOptionsSchema.parse({
      from: '2024-01-01',
      to: '2024-12-31',
    })

    expect(result.chunk).toBe('month')
  })

  it('accepts week chunk', () => {
    const result = BackfillOptionsSchema.parse({
      from: '2024-01-01',
      to: '2024-12-31',
      chunk: 'week',
    })

    expect(result.chunk).toBe('week')
  })

  it('accepts day chunk', () => {
    const result = BackfillOptionsSchema.parse({
      from: '2024-01-01',
      to: '2024-12-31',
      chunk: 'day',
    })

    expect(result.chunk).toBe('day')
  })

  it('rejects invalid chunk value', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        from: '2024-01-01',
        to: '2024-12-31',
        chunk: 'year',
      }),
    ).toThrow()
  })

  it('rejects invalid date format for from', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        from: '2024/01/01',
        to: '2024-12-31',
      }),
    ).toThrow()
  })

  it('rejects invalid date format for to', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        from: '2024-01-01',
        to: '12-31-2024',
      }),
    ).toThrow()
  })

  it('parses options with sources', () => {
    const result = BackfillOptionsSchema.parse({
      from: '2024-01-01',
      to: '2024-12-31',
      sources: ['mercury', 'givebutter'],
    })

    expect(result.sources).toEqual(['mercury', 'givebutter'])
  })

  it('parses skipMerge option', () => {
    const result = BackfillOptionsSchema.parse({
      from: '2024-01-01',
      to: '2024-12-31',
      skipMerge: true,
    })

    expect(result.skipMerge).toBe(true)
  })

  it('parses mergeOnly option', () => {
    const result = BackfillOptionsSchema.parse({
      mergeOnly: true,
    })

    expect(result.mergeOnly).toBe(true)
  })

  it('allows mergeOnly without from and to dates', () => {
    const result = BackfillOptionsSchema.parse({
      mergeOnly: true,
    })

    expect(result.mergeOnly).toBe(true)
    expect(result.from).toBeUndefined()
    expect(result.to).toBeUndefined()
  })

  it('rejects missing from and to when not using mergeOnly', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        chunk: 'month',
      }),
    ).toThrow('--from and --to are required unless using --merge-only')
  })

  it('rejects missing from when not using mergeOnly', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        to: '2024-12-31',
      }),
    ).toThrow('--from and --to are required unless using --merge-only')
  })

  it('rejects missing to when not using mergeOnly', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        from: '2024-01-01',
      }),
    ).toThrow('--from and --to are required unless using --merge-only')
  })

  it('rejects skipMerge and mergeOnly together', () => {
    expect(() =>
      BackfillOptionsSchema.parse({
        from: '2024-01-01',
        to: '2024-12-31',
        skipMerge: true,
        mergeOnly: true,
      }),
    ).toThrow('Cannot use --skip-merge and --merge-only together')
  })
})

describe('createCli', () => {
  it('creates a commander program', () => {
    const program = createCli()

    expect(program.name()).toBe('donations-etl')
  })

  it('has daily command', () => {
    const program = createCli()
    const daily = program.commands.find((c) => c.name() === 'daily')

    expect(daily).toBeDefined()
  })

  it('has backfill command', () => {
    const program = createCli()
    const backfill = program.commands.find((c) => c.name() === 'backfill')

    expect(backfill).toBeDefined()
  })

  it('has health command', () => {
    const program = createCli()
    const health = program.commands.find((c) => c.name() === 'health')

    expect(health).toBeDefined()
  })
})

describe('parseCli', () => {
  describe('daily command', () => {
    it('parses daily command without options', () => {
      const result = parseCli(['daily'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {},
      })
    })

    it('parses daily command with sources option', () => {
      const result = parseCli(['daily', '--sources', 'mercury,paypal'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['mercury', 'paypal'],
        },
      })
    })

    it('parses single source', () => {
      const result = parseCli(['daily', '--sources', 'mercury'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['mercury'],
        },
      })
    })

    it('trims whitespace from sources', () => {
      const result = parseCli(['daily', '--sources', 'mercury , paypal'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['mercury', 'paypal'],
        },
      })
    })

    it('normalizes source names to lowercase', () => {
      const result = parseCli(['daily', '--sources', 'MERCURY,PayPal'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['mercury', 'paypal'],
        },
      })
    })

    it('accepts check_deposits as a source', () => {
      const result = parseCli(['daily', '--sources', 'check_deposits'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['check_deposits'],
        },
      })
    })

    it('accepts all four sources together', () => {
      const result = parseCli([
        'daily',
        '--sources',
        'mercury,paypal,givebutter,check_deposits',
      ])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['mercury', 'paypal', 'givebutter', 'check_deposits'],
        },
      })
    })

    it('returns error for invalid source', () => {
      const result = parseCli(['daily', '--sources', 'mercury,invalid'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain('Invalid source')
    })

    it('parses --skip-merge flag', () => {
      const result = parseCli(['daily', '--skip-merge'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          skipMerge: true,
        },
      })
    })

    it('parses --merge-only flag', () => {
      const result = parseCli(['daily', '--merge-only'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          mergeOnly: true,
        },
      })
    })

    it('returns error when both --skip-merge and --merge-only are used', () => {
      const result = parseCli(['daily', '--skip-merge', '--merge-only'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain(
        'Cannot use --skip-merge and --merge-only together',
      )
    })

    it('parses --skip-merge with sources', () => {
      const result = parseCli(['daily', '--sources', 'mercury', '--skip-merge'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'daily',
        options: {
          sources: ['mercury'],
          skipMerge: true,
        },
      })
    })
  })

  describe('backfill command', () => {
    it('parses backfill command with required options', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
      ])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'backfill',
        options: {
          from: '2024-01-01',
          to: '2024-12-31',
          chunk: 'month',
        },
      })
    })

    it('parses backfill command with chunk option', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
        '--chunk',
        'week',
      ])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'backfill',
        options: {
          from: '2024-01-01',
          to: '2024-12-31',
          chunk: 'week',
        },
      })
    })

    it('parses backfill command with sources option', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
        '--sources',
        'mercury,givebutter',
      ])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'backfill',
        options: {
          from: '2024-01-01',
          to: '2024-12-31',
          chunk: 'month',
          sources: ['mercury', 'givebutter'],
        },
      })
    })

    it('returns error when from is missing', () => {
      const result = parseCli(['backfill', '--to', '2024-12-31'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain(
        '--from and --to are required unless using --merge-only',
      )
    })

    it('returns error when to is missing', () => {
      const result = parseCli(['backfill', '--from', '2024-01-01'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain(
        '--from and --to are required unless using --merge-only',
      )
    })

    it('returns error for invalid date format', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024/01/01',
        '--to',
        '2024-12-31',
      ])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
    })

    it('returns error for invalid chunk value', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
        '--chunk',
        'year',
      ])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
    })

    it('returns error for invalid source in backfill', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
        '--sources',
        'mercury,invalid',
      ])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain('Invalid source')
    })

    it('parses --skip-merge flag', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
        '--skip-merge',
      ])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'backfill',
        options: {
          from: '2024-01-01',
          to: '2024-12-31',
          chunk: 'month',
          skipMerge: true,
        },
      })
    })

    it('parses --merge-only flag without dates', () => {
      const result = parseCli(['backfill', '--merge-only'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'backfill',
        options: {
          chunk: 'month',
          mergeOnly: true,
        },
      })
    })

    it('returns error when both --skip-merge and --merge-only are used', () => {
      const result = parseCli([
        'backfill',
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
        '--skip-merge',
        '--merge-only',
      ])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain(
        'Cannot use --skip-merge and --merge-only together',
      )
    })

    it('returns error when dates missing without --merge-only', () => {
      const result = parseCli(['backfill'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('validation')
      expect(result._unsafeUnwrapErr().message).toContain(
        '--from and --to are required unless using --merge-only',
      )
    })
  })

  describe('health command', () => {
    it('parses health command', () => {
      const result = parseCli(['health'])

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        command: 'health',
      })
    })
  })

  describe('error handling', () => {
    it('returns error for unknown command', () => {
      const result = parseCli(['unknown'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('parse')
      // Commander treats unknown command as parse error
      expect(result._unsafeUnwrapErr().message).toContain('Failed to parse')
    })

    it('returns error for empty args', () => {
      const result = parseCli([])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('parse')
    })

    it('returns error for invalid option', () => {
      const result = parseCli(['daily', '--invalid-option'])

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe('parse')
    })
  })
})
