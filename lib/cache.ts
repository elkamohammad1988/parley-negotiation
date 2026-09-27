// Process-local cache. On Vercel this only helps requests that land on the
// same warm serverless instance as a previous request for the same key —
// there's no cross-instance sharing, so treat hits as a bonus, not a
// guarantee. Fine for data like character rows that are cheap to refetch
// and don't gate access to anything.
const cache = new Map<string, {
  data: unknown
  expiresAt: number
}>()

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

export function setCached(
  key: string,
  data: unknown,
  ttlMs: number = 5 * 60 * 1000 // 5 min default
): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
