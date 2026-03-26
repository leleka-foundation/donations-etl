/**
 * Coverage threshold verification for pre-commit hooks
 *
 * Ensures vitest coverage thresholds in vitest.config.ts remain at 100%.
 */

import { z } from 'zod'

const ThresholdsSchema = z.object({
  test: z.object({
    coverage: z.object({
      thresholds: z.object({
        statements: z.literal(100),
        branches: z.literal(100),
        functions: z.literal(100),
        lines: z.literal(100),
      }),
    }),
  }),
})

export async function main(testConfig?: { default: unknown }): Promise<void> {
  let exitCode = 0

  try {
    const config = testConfig ?? (await import('../vitest.config'))
    ThresholdsSchema.parse(config.default)
    console.log('✅ Coverage thresholds verified (all at 100%)')
  } catch (error) {
    exitCode = 1
    if (error instanceof z.ZodError) {
      console.error('\n==========================================')
      console.error('  COMMIT BLOCKED: Coverage Thresholds Modified')
      console.error('==========================================\n')
      console.error('All coverage thresholds must be 100%.')
      console.error('Please restore the thresholds in vitest.config.ts.\n')
    } else {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  process.exit(exitCode)
}

/* istanbul ignore next -- @preserve entrypoint with unreliable async timing in tests */
if (
  import.meta.main ||
  process.env.STUDIO_COVERAGE_THRESHOLDS_RUN_MAIN === 'true'
) {
  main()
    .catch(
      /* istanbul ignore next -- @preserve */ (err) => {
        console.error(err)
        process.exit(1)
      },
    )
    .catch(
      /* istanbul ignore next -- @preserve */ () => {
        // Handle errors thrown by process.exit mock in test environment
      },
    )
}
