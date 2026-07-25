// Tiny cross-request TTL cache for the resolve path's config-ish reads
// (settings, rules, tiers, tier scope config, holidays, timezone). These tables
// change only when an admin edits Delivery settings, yet every cart validate
// and estimate re-read all of them - on a serverless deploy whose database sits
// an ocean away that was most of the request. A short TTL keeps admin edits
// near-live (each instance re-reads within TTL_MS) while collapsing the
// steady-state shopper path to zero queries for these tables. Same precedent as
// shop's getShopConfigCached (5s TTL).
//
// In-flight dedupe: concurrent callers during a cold read share one promise, so
// a burst of parallel cart lines never stampedes the same query. A rejected
// read clears the slot so the next caller retries rather than caching an error.

type Slot<T> = { promise: Promise<T>; at: number }

export function ttlCached<T>(fn: () => Promise<T>, ttlMs: number): { get: () => Promise<T>; invalidate: () => void } {
  let slot: Slot<T> | null = null
  return {
    get(): Promise<T> {
      const now = Date.now()
      if (slot && now - slot.at < ttlMs) return slot.promise
      const promise = fn()
      const mine: Slot<T> = { promise, at: now }
      slot = mine
      promise.catch(() => { if (slot === mine) slot = null })
      return promise
    },
    invalidate(): void {
      slot = null
    },
  }
}

// Keyed variant (e.g. holiday sets per region).
export function ttlCachedByKey<K, T>(
  fn: (key: K) => Promise<T>,
  ttlMs: number,
): { get: (key: K) => Promise<T>; invalidate: () => void } {
  const slots = new Map<K, Slot<T>>()
  return {
    get(key: K): Promise<T> {
      const now = Date.now()
      const existing = slots.get(key)
      if (existing && now - existing.at < ttlMs) return existing.promise
      const promise = fn(key)
      const mine: Slot<T> = { promise, at: now }
      slots.set(key, mine)
      promise.catch(() => { if (slots.get(key) === mine) slots.delete(key) })
      return promise
    },
    invalidate(): void {
      slots.clear()
    },
  }
}
