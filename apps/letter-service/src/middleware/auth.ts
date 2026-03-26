/**
 * Bearer token authentication middleware.
 */

/**
 * Validate a Bearer token from the Authorization header.
 *
 * Returns true if the token matches the expected API key.
 */
export function validateBearerToken(
  authHeader: string | null,
  expectedKey: string,
): boolean {
  if (!authHeader) return false
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false
  return parts[1] === expectedKey
}
