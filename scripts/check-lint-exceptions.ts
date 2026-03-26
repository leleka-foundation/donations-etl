/**
 * Lint exception detection for pre-commit hooks
 *
 * Detects ESLint and TypeScript exception comments in staged changes
 * that bypass linting guardrails.
 */

import { Command } from 'commander'
import { z } from 'zod'

/**
 * Zod schema for CLI arguments
 */
export const LintExceptionsArgsSchema = z.object({
  tree: z.boolean().default(false),
})

export type LintExceptionsArgs = z.infer<typeof LintExceptionsArgsSchema>

/**
 * Parses command-line arguments using commander + Zod validation.
 */
export function parseArgs(args: string[]): LintExceptionsArgs {
  const program = new Command()
    .name('check-lint-exceptions')
    .description(
      'Detect ESLint and TypeScript exception comments in staged changes',
    )
    .option('--tree', 'Check entire file tree instead of staged changes')
    .exitOverride()

  program.parse(args, { from: 'user' })

  const opts: unknown = program.opts()
  const OptsSchema = z.object({ tree: z.boolean().optional() })
  const parsed = OptsSchema.parse(opts)
  return LintExceptionsArgsSchema.parse({
    tree: parsed.tree ?? false,
  })
}

/**
 * Represents a lint exception violation found in the diff or file
 */
export interface LintViolation {
  type: 'eslint' | 'typescript'
  pattern: string
  line: string
  lineNumber: number
  file?: string
}

/**
 * Patterns that bypass linting guardrails
 */
const ESLINT_PATTERNS = [
  'eslint-disable-next-line',
  'eslint-disable-line',
  'eslint-disable',
] as const

const TYPESCRIPT_PATTERNS = [
  '@ts-ignore',
  '@ts-nocheck',
  '@ts-expect-error',
] as const

/**
 * Patterns to identify files that should be excluded from the check
 */
const EXCLUDED_FILE_PATTERNS = [
  // This script and its tests (need to define/test the patterns)
  /check-lint-exceptions\.ts$/,
  /check-lint-exceptions\.test\.ts$/,
  // Test files - type assertions are legitimate for mocking external SDK types
  /\.test\.ts$/,
] as const

/**
 * Checks if a file path should be excluded from the check
 */
function isExcludedFile(filePath: string): boolean {
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
}

/**
 * Detects lint exception comments in a git diff
 *
 * Only looks at added lines (lines starting with +) to catch
 * newly introduced violations.
 *
 * @param diff - The git diff output
 * @returns Array of detected violations
 */
export function detectLintExceptions(diff: string): LintViolation[] {
  if (!diff) {
    return []
  }

  const violations: LintViolation[] = []
  const lines = diff.split('\n')
  let currentFile = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    /* istanbul ignore if -- @preserve defensive array access for TypeScript strict mode */
    if (line === undefined) continue

    // Track which file we're in
    if (line.startsWith('diff --git')) {
      // Extract file path: "diff --git a/path/to/file.ts b/path/to/file.ts"
      const match = /diff --git a\/(.+) b\//.exec(line)
      currentFile = match?.[1] ?? ''
      continue
    }

    // Skip excluded files (test files, this script itself)
    if (isExcludedFile(currentFile)) {
      continue
    }

    // Only check added lines (starting with +, but not +++ which is file header)
    if (!line.startsWith('+') || line.startsWith('+++')) {
      continue
    }

    const content = line.slice(1) // Remove the leading +

    // Check for ESLint patterns (must match exactly with word boundary)
    // Order matters: check longer patterns first
    for (const pattern of ESLINT_PATTERNS) {
      // Use word boundary to avoid matching "eslint disable" (without hyphen)
      const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`)
      if (regex.test(content)) {
        violations.push({
          type: 'eslint',
          pattern,
          line: content,
          lineNumber: i + 1,
        })
        break // Only report first match per line
      }
    }

    // Check for TypeScript patterns
    for (const pattern of TYPESCRIPT_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push({
          type: 'typescript',
          pattern,
          line: content,
          lineNumber: i + 1,
        })
        break // Only report first match per line
      }
    }
  }

  return violations
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Checks a file's content for lint exception comments
 *
 * @param content - The file content
 * @param filePath - The file path (for exclusion checking and reporting)
 * @returns Array of detected violations
 */
export function checkFileContent(
  content: string,
  filePath: string,
): LintViolation[] {
  if (isExcludedFile(filePath)) {
    return []
  }

  const violations: LintViolation[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    /* istanbul ignore if -- @preserve defensive array access for TypeScript strict mode */
    if (line === undefined) continue

    // Check for ESLint patterns
    for (const pattern of ESLINT_PATTERNS) {
      const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`)
      if (regex.test(line)) {
        violations.push({
          type: 'eslint',
          pattern,
          line,
          lineNumber: i + 1,
          file: filePath,
        })
        break
      }
    }

    // Check for TypeScript patterns
    for (const pattern of TYPESCRIPT_PATTERNS) {
      if (line.includes(pattern)) {
        violations.push({
          type: 'typescript',
          pattern,
          line,
          lineNumber: i + 1,
          file: filePath,
        })
        break
      }
    }
  }

  return violations
}

/**
 * File extensions to check in tree mode
 */
const CHECKABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Directories to skip in tree mode
 */
const SKIP_DIRECTORIES = ['node_modules', '.git', 'dist', 'build', 'coverage']

/**
 * File system operations interface for dependency injection
 */
export interface FileSystemOps {
  readdir: (path: string) => string[]
  stat: (path: string) => { isDirectory: boolean; isFile: boolean }
  readFile: (path: string) => string
}

/**
 * Recursively walks a directory tree and checks all files
 */
export function walkTree(dir: string, fs: FileSystemOps): LintViolation[] {
  const violations: LintViolation[] = []
  const entries = fs.readdir(dir)

  for (const entry of entries) {
    const fullPath = dir === '.' ? entry : `${dir}/${entry}`

    // Skip hidden files and directories
    if (entry.startsWith('.')) {
      continue
    }

    // Skip excluded directories
    if (SKIP_DIRECTORIES.includes(entry)) {
      continue
    }

    const stat = fs.stat(fullPath)

    if (stat.isDirectory) {
      violations.push(...walkTree(fullPath, fs))
    } else if (stat.isFile) {
      // Only check files with relevant extensions
      const hasCheckableExtension = CHECKABLE_EXTENSIONS.some((ext) =>
        fullPath.endsWith(ext),
      )
      if (hasCheckableExtension) {
        const content = fs.readFile(fullPath)
        violations.push(...checkFileContent(content, fullPath))
      }
    }
  }

  return violations
}

/**
 * Formats violations into a human-readable report
 *
 * @param violations - Array of detected violations
 * @returns Formatted report string, or empty string if no violations
 */
export function formatViolationReport(violations: LintViolation[]): string {
  if (violations.length === 0) {
    return ''
  }

  const eslintViolations = violations.filter((v) => v.type === 'eslint')
  const tsViolations = violations.filter((v) => v.type === 'typescript')

  const lines: string[] = [
    '',
    '==========================================',
    '  COMMIT BLOCKED: Lint Exceptions Found',
    '==========================================',
    '',
    'Your commit contains code comments that bypass linting guardrails.',
    'These are not allowed as they undermine code quality checks.',
    '',
  ]

  if (eslintViolations.length > 0) {
    lines.push('ESLint exceptions found:')
    for (const v of eslintViolations.slice(0, 20)) {
      const location = v.file
        ? `${v.file}:${v.lineNumber}`
        : String(v.lineNumber)
      lines.push(`  ${location}: ${v.line}`)
    }
    lines.push('')
  }

  if (tsViolations.length > 0) {
    lines.push('TypeScript exceptions found:')
    for (const v of tsViolations.slice(0, 20)) {
      const location = v.file
        ? `${v.file}:${v.lineNumber}`
        : String(v.lineNumber)
      lines.push(`  ${location}: ${v.line}`)
    }
    lines.push('')
  }

  lines.push(
    'Please fix the underlying issues instead of disabling the checks.',
  )
  lines.push('')
  lines.push('Blocked patterns:')
  lines.push(
    '  - eslint-disable, eslint-disable-next-line, eslint-disable-line',
  )
  lines.push('  - @ts-ignore, @ts-nocheck, @ts-expect-error')
  lines.push('')

  return lines.join('\n')
}

/**
 * Main function for CLI usage
 *
 * @param args - Command line arguments (optional)
 *   --tree: Check entire file tree instead of staged changes
 * @param testFs - Optional FileSystemOps for testing
 */
export async function main(
  args: string[] = [],
  testFs?: FileSystemOps,
): Promise<number> {
  const parsedArgs = parseArgs(args)
  const treeMode = parsedArgs.tree

  if (treeMode) {
    let fs: FileSystemOps

    if (testFs) {
      fs = testFs
    } else {
      const { readdirSync, readFileSync, statSync } = await import('node:fs')
      fs = {
        readdir: (path) => readdirSync(path, { encoding: 'utf-8' }),
        stat: (path) => {
          const s = statSync(path)
          return { isDirectory: s.isDirectory(), isFile: s.isFile() }
        },
        readFile: (path) => readFileSync(path, 'utf-8'),
      }
    }

    const violations = walkTree('.', fs)

    if (violations.length > 0) {
      console.error(formatViolationReport(violations))
      return 1
    }

    return 0
  }

  // Default: check staged changes
  const { execSync } = await import('node:child_process')

  let diff: string
  try {
    diff = execSync('git diff --cached --diff-filter=ACMR', {
      encoding: 'utf-8',
    })
  } catch {
    // No staged changes or git error
    return 0
  }

  const violations = detectLintExceptions(diff)

  if (violations.length > 0) {
    console.error(formatViolationReport(violations))
    return 1
  }

  return 0
}

// Run if executed directly
if (
  import.meta.main ||
  process.env.STUDIO_LINT_EXCEPTIONS_RUN_MAIN === 'true'
) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error('Error:', error)
      process.exit(1)
    })
}
