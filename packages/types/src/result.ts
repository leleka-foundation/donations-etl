/**
 * Result type utilities.
 *
 * Re-exports neverthrow types and provides helper functions
 * for working with Result types in async contexts.
 */
import {
  Result,
  ResultAsync,
  err,
  errAsync,
  fromPromise,
  fromSafePromise,
  ok,
  okAsync,
} from 'neverthrow'

// Re-export all neverthrow types for convenience
export {
  Result,
  ResultAsync,
  err,
  errAsync,
  fromPromise,
  fromSafePromise,
  ok,
  okAsync,
}

/**
 * Wrap a Promise in a ResultAsync, catching any thrown errors.
 *
 * @param promise The promise to wrap
 * @param mapError Function to convert thrown error to error type
 */
export function wrapPromise<T, E>(
  promise: Promise<T>,
  mapError: (error: unknown) => E,
): ResultAsync<T, E> {
  return ResultAsync.fromPromise(promise, mapError)
}

/**
 * Wrap fetch in a ResultAsync with error mapping.
 *
 * @param url URL to fetch
 * @param options Fetch options
 * @param mapError Function to convert errors
 */
export function safeFetch<E>(
  url: string,
  options: RequestInit | undefined,
  mapError: (error: unknown) => E,
): ResultAsync<Response, E> {
  return ResultAsync.fromPromise(fetch(url, options), mapError)
}

/**
 * Combine multiple Results into a single Result containing an array.
 * If any Result is an error, returns the first error.
 *
 * @param results Array of Results to combine
 */
export function combineResults<T, E>(results: Result<T, E>[]): Result<T[], E> {
  return Result.combine(results)
}

/**
 * Combine multiple ResultAsyncs into a single ResultAsync containing an array.
 * If any ResultAsync is an error, returns the first error.
 *
 * @param results Array of ResultAsyncs to combine
 */
export function combineResultAsyncs<T, E>(
  results: ResultAsync<T, E>[],
): ResultAsync<T[], E> {
  return ResultAsync.combine(results)
}

/**
 * Execute a function for each item in an array, returning early on first error.
 * Similar to Array.map but short-circuits on error.
 *
 * @param items Items to process
 * @param fn Function that returns a ResultAsync for each item
 */
export function traverseResultAsync<T, U, E>(
  items: T[],
  fn: (item: T) => ResultAsync<U, E>,
): ResultAsync<U[], E> {
  return ResultAsync.combine(items.map(fn))
}

/**
 * Execute a function for each item sequentially, accumulating results.
 * Unlike combine, this runs one at a time (useful for rate-limited APIs).
 *
 * @param items Items to process
 * @param fn Function that returns a ResultAsync for each item
 */
export async function traverseSequential<T, U, E>(
  items: T[],
  fn: (item: T, index: number) => ResultAsync<U, E>,
): Promise<Result<U[], E>> {
  const results: U[] = []

  for (const [index, item] of items.entries()) {
    const result = await fn(item, index)
    if (result.isErr()) {
      return err(result.error)
    }
    results.push(result.value)
  }

  return ok(results)
}

/**
 * Tap into a successful result without modifying it.
 * Useful for logging or side effects.
 */
export function tapResult<T, E>(
  result: Result<T, E>,
  onOk: (value: T) => void,
): Result<T, E> {
  if (result.isOk()) {
    onOk(result.value)
  }
  return result
}

/**
 * Tap into an error result without modifying it.
 * Useful for logging errors.
 */
export function tapError<T, E>(
  result: Result<T, E>,
  onErr: (error: E) => void,
): Result<T, E> {
  if (result.isErr()) {
    onErr(result.error)
  }
  return result
}
