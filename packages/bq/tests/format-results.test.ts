/**
 * Tests for LLM-powered result formatting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BigQueryConfig } from '../src/types'

// Mock dependencies
const mockGenerateText =
  vi.fn<
    (opts: {
      model: unknown
      system: string
      prompt: string
    }) => Promise<{ text: string | null }>
  >()

vi.mock('@ai-sdk/google-vertex', () => ({
  createVertex: () => (modelName: string) => ({ modelId: modelName }),
}))

vi.mock('ai', () => ({
  generateText: (
    ...args: Parameters<typeof mockGenerateText>
  ): ReturnType<typeof mockGenerateText> => mockGenerateText(...args),
}))

import { formatResultsWithLlm } from '../src/format-results'

describe('formatResultsWithLlm', () => {
  const config: BigQueryConfig = {
    projectId: 'test-project',
    datasetRaw: 'donations_raw',
    datasetCanon: 'donations',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns formatted text from the model', async () => {
    mockGenerateText.mockResolvedValue({
      text: '*$15,000* total donations :moneybag:',
    })

    const result = await formatResultsWithLlm(
      'How much did we raise?',
      'Total succeeded donations',
      [{ total_dollars: 15000 }],
      config,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toContain('$15,000')
    }
  })

  it('passes question, explanation, and data in prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: 'formatted' })

    await formatResultsWithLlm(
      'Top donors?',
      'Query explanation',
      [{ donor: 'John', total: 5000 }],
      config,
    )

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining('Top donors?'),
      }),
    )
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining('Query explanation'),
      }),
    )
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining('John'),
      }),
    )
  })

  it('includes system prompt with formatting rules', async () => {
    mockGenerateText.mockResolvedValue({ text: 'formatted' })

    await formatResultsWithLlm('test', 'test', [{ x: 1 }], config)

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        system: expect.stringContaining('mrkdwn'),
      }),
    )
  })

  it('returns error when model returns no text', async () => {
    mockGenerateText.mockResolvedValue({ text: null })

    const result = await formatResultsWithLlm(
      'test',
      'test',
      [{ x: 1 }],
      config,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('format')
      expect(result.error.message).toContain('no text')
    }
  })

  it('handles non-Error API failures', async () => {
    mockGenerateText.mockRejectedValue('string error')

    const result = await formatResultsWithLlm(
      'test',
      'test',
      [{ x: 1 }],
      config,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toContain('string error')
    }
  })

  it('returns error when API call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'))

    const result = await formatResultsWithLlm(
      'test',
      'test',
      [{ x: 1 }],
      config,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.type).toBe('format')
      expect(result.error.message).toContain('API error')
    }
  })

  it('truncates rows to 50 for large result sets', async () => {
    mockGenerateText.mockResolvedValue({ text: 'formatted' })

    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
    await formatResultsWithLlm('test', 'test', rows, config)

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining('showing first 50'),
      }),
    )
  })

  it('does not mention truncation for small result sets', async () => {
    mockGenerateText.mockResolvedValue({ text: 'formatted' })

    await formatResultsWithLlm('test', 'test', [{ id: 1 }, { id: 2 }], config)

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.not.stringContaining('showing first'),
      }),
    )
  })
})
