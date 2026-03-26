/**
 * Pre-commit hook to block introduction of actions/github-script.
 *
 * We've migrated all workflow logic to TypeScript actions for:
 * - Testability (100% coverage requirement)
 * - Type safety (Zod validation)
 * - Consistency (all actions follow the same pattern)
 *
 * This hook prevents regression by blocking any new github-script usage.
 */

import { exec } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface CheckResult {
  success: boolean
  errors: string[]
}

/**
 * Parse git diff --cached output to get list of staged files.
 */
export function parseStagedFiles(gitOutput: string): string[] {
  return gitOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Format is "M\tpath/to/file" or "A\tpath/to/file" etc.
      // D (deleted) files should be excluded since we can't read them
      const parts = line.split('\t')
      /* istanbul ignore next -- @preserve defensive array access */
      const status = parts[0] ?? ''
      /* istanbul ignore next -- @preserve defensive array access */
      const path = parts[1] ?? ''
      return { status, path }
    })
    .filter(({ status, path }) => path.length > 0 && status !== 'D')
    .map(({ path }) => path)
}

/**
 * Check if file content contains github-script usage.
 */
export function containsGithubScript(content: string): boolean {
  // Match: uses: actions/github-script@v... or uses: 'actions/github-script@v...'
  return /uses:\s*['"]?actions\/github-script@/.test(content)
}

/**
 * Check staged workflow files for github-script usage.
 */
export async function checkGithubScript(
  stagedFiles: string[],
  readFileFn: (path: string) => Promise<string> = (path) =>
    readFile(path, 'utf-8'),
): Promise<CheckResult> {
  const errors: string[] = []

  // Filter to workflow files only
  const workflowFiles = stagedFiles.filter(
    (f) =>
      (f.startsWith('.github/workflows/') || f.startsWith('workflows/')) &&
      f.endsWith('.yml'),
  )

  for (const file of workflowFiles) {
    try {
      const content = await readFileFn(file)
      if (containsGithubScript(content)) {
        errors.push(
          `❌ ${file} contains actions/github-script usage.\n` +
            `   Create a TypeScript action instead for testability and type safety.\n` +
            `   See actions/pr-details/ for an example.`,
        )
      }
    } catch {
      // File might not exist (e.g., renamed), skip it
    }
  }

  return {
    success: errors.length === 0,
    errors,
  }
}

/**
 * Main function to run the check.
 */
export async function main(): Promise<void> {
  try {
    const { stdout } = await execAsync('git diff --cached --name-status')
    const stagedFiles = parseStagedFiles(stdout)

    const result = await checkGithubScript(stagedFiles)

    if (!result.success) {
      console.error('\n🚨 GitHub Script check failed:\n')
      for (const error of result.errors) {
        console.error(error)
        console.error('')
      }
      console.error(
        'All workflow logic must be in TypeScript actions with 100% test coverage.\n',
      )
      process.exit(1)
    }

    console.log('✅ GitHub Script check passed')
    process.exit(0)
  } catch (error) {
    console.error('Error running GitHub Script check:', error)
    process.exit(1)
  }
}

// Run if executed directly
/* istanbul ignore next -- @preserve entrypoint tested via environment variable */
if (
  import.meta.main ||
  process.env.STUDIO_CHECK_GITHUB_SCRIPT_RUN_MAIN === 'true'
) {
  main()
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
    .catch(() => {
      // Handle errors thrown by process.exit mock in test environment
    })
}
