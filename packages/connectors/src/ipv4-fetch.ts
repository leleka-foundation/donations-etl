/**
 * IPv4-only fetch wrapper.
 *
 * Bun's fetch() uses IPv6 when available, but some APIs (like Mercury)
 * only whitelist IPv4 addresses. This wrapper resolves hostnames to
 * IPv4 first, then makes requests to the IP with the Host header set.
 *
 * Works in both Bun and Node.js environments.
 */
import nodeDns from 'node:dns/promises'

/**
 * Resolve a hostname to its IPv4 address.
 * Returns null if no IPv4 address is found.
 */
async function resolveIPv4(hostname: string): Promise<string | null> {
  try {
    // Use Node.js dns module which works in both Bun and Node.js
    const result = await nodeDns.lookup(hostname, { family: 4 })
    return result.address
  } catch {
    return null
  }
}

/**
 * Cache for hostname -> IPv4 address mappings.
 * Simple in-memory cache to avoid repeated DNS lookups.
 */
const ipv4Cache = new Map<string, { address: string; expiry: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Clear the entire IPv4 address cache.
 * Exported for testing purposes.
 */
export function clearIPv4Cache(): void {
  ipv4Cache.clear()
}

/**
 * Invalidate a specific hostname's cached IPv4 address.
 * Call this when a connection error occurs to force a fresh DNS lookup.
 */
export function invalidateIPv4Cache(hostname: string): void {
  ipv4Cache.delete(hostname)
}

/**
 * Get IPv4 address for hostname, using cache.
 */
async function getIPv4Address(hostname: string): Promise<string | null> {
  const cached = ipv4Cache.get(hostname)
  if (cached && cached.expiry > Date.now()) {
    return cached.address
  }

  const address = await resolveIPv4(hostname)
  if (address) {
    ipv4Cache.set(hostname, { address, expiry: Date.now() + CACHE_TTL_MS })
  }
  return address
}

/**
 * Fetch with forced IPv4 resolution.
 *
 * This is a drop-in replacement for fetch() that forces IPv4 DNS resolution.
 * Necessary for APIs like Mercury that only whitelist IPv4 addresses.
 */
export async function fetchIPv4(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  // Parse the URL
  const url = new URL(input instanceof Request ? input.url : input.toString())

  // Only modify for https/http URLs with hostnames (not IPs)
  if (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !isIPAddress(url.hostname)
  ) {
    const ipv4 = await getIPv4Address(url.hostname)

    if (ipv4) {
      // Store original hostname for Host header
      const originalHostname = url.hostname

      // Replace hostname with IPv4 address
      url.hostname = ipv4

      // Build new headers with Host header
      const headers = new Headers(init?.headers)
      headers.set('Host', originalHostname)

      // Make request with modified URL and Host header
      // On connection error, invalidate cache so next request tries fresh DNS
      // This handles cases where the IP changed (DNS updated but cache is stale)
      return fetch(url.toString(), {
        ...init,
        headers,
      }).catch((error: unknown) => {
        invalidateIPv4Cache(originalHostname)
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        )
      })
    }
  }

  // Fallback to regular fetch if IPv4 resolution fails
  return fetch(input, init)
}

/**
 * Check if a string is an IP address (v4 or v6).
 *
 * For IPv4: matches pattern like "192.168.1.1" (4 groups of 1-3 digits)
 * For IPv6: any hostname containing colons (simplified check)
 *
 * Note: This doesn't validate the actual values (e.g., 999.999.999.999 would match).
 * The purpose is to skip DNS resolution for obvious IP addresses, not full validation.
 */
function isIPAddress(hostname: string): boolean {
  // IPv4: exactly 4 groups of 1-3 digits separated by dots
  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  // IPv6: contains colons (simplified check, covers [::1] style addresses)
  const isIPv6 = hostname.includes(':')
  return isIPv4 || isIPv6
}
