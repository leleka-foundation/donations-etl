import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../src/result'
import {
  combineResultAsyncs,
  combineResults,
  err,
  errAsync,
  ok,
  okAsync,
  safeFetch,
  tapError,
  tapResult,
  traverseResultAsync,
  traverseSequential,
  wrapPromise,
} from '../src/result'

describe('Result re-exports', () => {
  it('exports ok and err constructors', () => {
    const success = ok(42)
    const failure = err('error')

    expect(success.isOk()).toBe(true)
    expect(success._unsafeUnwrap()).toBe(42)
    expect(failure.isErr()).toBe(true)
    expect(failure._unsafeUnwrapErr()).toBe('error')
  })

  it('exports okAsync and errAsync constructors', async () => {
    const success = okAsync(42)
    const failure = errAsync('error')

    const successResult = await success
    const failureResult = await failure

    expect(successResult.isOk()).toBe(true)
    expect(failureResult.isErr()).toBe(true)
  })
})

describe('wrapPromise', () => {
  it('wraps resolved promise as Ok', async () => {
    const promise = Promise.resolve(42)
    const result = await wrapPromise(promise, (e) => String(e))

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe(42)
  })

  it('wraps rejected promise as Err', async () => {
    const promise = Promise.reject(new Error('failed'))
    const result = await wrapPromise(promise, (e) => {
      if (e instanceof Error) return e.message
      return String(e)
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('failed')
  })

  it('applies error mapper function', async () => {
    const promise = Promise.reject(new Error('original'))
    const result = await wrapPromise(promise, () => ({
      type: 'custom',
      message: 'mapped error',
    }))

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({
      type: 'custom',
      message: 'mapped error',
    })
  })
})

describe('combineResults', () => {
  it('combines all Ok results into Ok array', () => {
    const results = [ok(1), ok(2), ok(3)]
    const combined = combineResults(results)

    expect(combined.isOk()).toBe(true)
    expect(combined._unsafeUnwrap()).toEqual([1, 2, 3])
  })

  it('returns first Err if any result is Err', () => {
    const results = [ok(1), err('error1'), ok(3), err('error2')]
    const combined = combineResults(results)

    expect(combined.isErr()).toBe(true)
    expect(combined._unsafeUnwrapErr()).toBe('error1')
  })

  it('handles empty array', () => {
    const results: Result<number, string>[] = []
    const combined = combineResults(results)

    expect(combined.isOk()).toBe(true)
    expect(combined._unsafeUnwrap()).toEqual([])
  })
})

describe('combineResultAsyncs', () => {
  it('combines all Ok results into Ok array', async () => {
    const results = [okAsync(1), okAsync(2), okAsync(3)]
    const combined = await combineResultAsyncs(results)

    expect(combined.isOk()).toBe(true)
    expect(combined._unsafeUnwrap()).toEqual([1, 2, 3])
  })

  it('returns first Err if any result is Err', async () => {
    const results = [okAsync(1), errAsync('error'), okAsync(3)]
    const combined = await combineResultAsyncs(results)

    expect(combined.isErr()).toBe(true)
    expect(combined._unsafeUnwrapErr()).toBe('error')
  })
})

describe('traverseResultAsync', () => {
  it('maps all items successfully', async () => {
    const items = [1, 2, 3]
    const result = await traverseResultAsync(items, (n) => okAsync(n * 2))

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([2, 4, 6])
  })

  it('returns error if any item fails', async () => {
    const items = [1, 2, 3]
    const result = await traverseResultAsync(items, (n) =>
      n === 2 ? errAsync('failed') : okAsync(n * 2),
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('failed')
  })
})

describe('traverseSequential', () => {
  it('processes items in order', async () => {
    const order: number[] = []
    const items = [1, 2, 3]

    const result = await traverseSequential(items, (n, index) => {
      order.push(index)
      return okAsync(n * 2)
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([2, 4, 6])
    expect(order).toEqual([0, 1, 2])
  })

  it('stops on first error', async () => {
    const processed: number[] = []
    const items = [1, 2, 3, 4]

    const result = await traverseSequential(items, (n) => {
      processed.push(n)
      if (n === 3) return errAsync('failed at 3')
      return okAsync(n * 2)
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe('failed at 3')
    expect(processed).toEqual([1, 2, 3]) // 4 was never processed
  })

  it('handles empty array', async () => {
    const result = await traverseSequential([], () => okAsync(1))

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('passes index to callback', async () => {
    const items = ['a', 'b', 'c']
    const result = await traverseSequential(items, (item, index) =>
      okAsync(`${item}${index}`),
    )

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(['a0', 'b1', 'c2'])
  })
})

describe('tapResult', () => {
  it('calls callback on Ok value', () => {
    const callback = vi.fn<(value: number) => void>()
    const result = ok(42)

    const tapped = tapResult(result, callback)

    expect(callback).toHaveBeenCalledWith(42)
    expect(tapped).toBe(result)
  })

  it('does not call callback on Err', () => {
    const callback = vi.fn<(value: never) => void>()
    const result = err('error')

    const tapped = tapResult(result, callback)

    expect(callback).not.toHaveBeenCalled()
    expect(tapped).toBe(result)
  })

  it('returns the same result instance', () => {
    const result = ok({ value: 42 })
    const tapped = tapResult(result, () => {})

    expect(tapped).toBe(result)
  })
})

describe('tapError', () => {
  it('calls callback on Err value', () => {
    const callback = vi.fn<(error: string) => void>()
    const result = err('error')

    const tapped = tapError(result, callback)

    expect(callback).toHaveBeenCalledWith('error')
    expect(tapped).toBe(result)
  })

  it('does not call callback on Ok', () => {
    const callback = vi.fn<(error: never) => void>()
    const result = ok(42)

    const tapped = tapError(result, callback)

    expect(callback).not.toHaveBeenCalled()
    expect(tapped).toBe(result)
  })

  it('returns the same result instance', () => {
    const result = err({ message: 'error' })
    const tapped = tapError(result, () => {})

    expect(tapped).toBe(result)
  })
})

describe('safeFetch', () => {
  it('wraps successful fetch as Ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(new Response('success', { status: 200 }))

    const result = await safeFetch(
      'https://example.com/api',
      undefined,
      (e) => ({
        type: 'network',
        message: e instanceof Error ? e.message : 'Unknown error',
      }),
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe(200)
    }

    fetchSpy.mockRestore()
  })

  it('wraps failed fetch as Err', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockRejectedValueOnce(new Error('Network failure'))

    const result = await safeFetch(
      'https://example.com/api',
      { method: 'POST' },
      (e) => ({
        type: 'network',
        message: e instanceof Error ? e.message : 'Unknown error',
      }),
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toBe('Network failure')
    }

    fetchSpy.mockRestore()
  })

  it('applies error mapper function', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await safeFetch(
      'https://example.com/api',
      undefined,
      () => ({
        type: 'custom_error',
        code: 'ECONNREFUSED',
      }),
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toEqual({
        type: 'custom_error',
        code: 'ECONNREFUSED',
      })
    }

    fetchSpy.mockRestore()
  })
})
