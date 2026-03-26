/**
 * Tests for logo loading fallback behavior.
 *
 * Separate file because vi.mock affects the entire module scope.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readFile: () => Promise.reject(new Error('ENOENT: no such file')),
}))

import { loadLogoBase64 } from '../src/html'

describe('loadLogoBase64 fallback', () => {
  it('returns empty string when no logo file is found', async () => {
    const result = await loadLogoBase64()

    expect(result).toBe('')
  })
})
