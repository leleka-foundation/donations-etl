import { defineConfig } from 'vitest/config'

export default defineConfig({
  ssr: {
    noExternal: ['zod'],
  },
  test: {
    exclude: ['*-workspace/**', '**/node_modules/**'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/tests/**',
        '*-workspace/**',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
