// Request-scoped batch cache for product delivery resolution. The cart-line
// resolver runs once per line, and resolveProductDeliveries is a handful of
// queries; resolving each line on its own turned a multi-line cart into dozens
// of round-trips. Shop's cart-line-resolver prefetch hook calls
// prefetchProductDeliveries once with the whole cart, so the per-line resolver
// below is a Map read rather than its own resolve. Without a prefetch (an older
// shop that never calls it) getProductDelivery falls back to a single resolve,
// so the resolver still works either way.
import { cache } from 'react'
import type { ProductDelivery, ResolveContext } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { resolveProductDeliveries } from '@/modules/advanced-shipping-for-shop/lib/resolve'

type DeliveryStore = { map: Map<string, ProductDelivery>; prefetched: boolean }

// One store per request: cache() with no args returns the same object for the
// life of the request, then a fresh one next request (no cross-request leak).
const requestStore = cache((): DeliveryStore => ({ map: new Map(), prefetched: false }))

// Resolve every product's delivery in one batched pass and hold it for the rest
// of the request. Idempotent within a request - a second call just re-warms.
export async function prefetchProductDeliveries(productIds: string[], ctx: ResolveContext): Promise<void> {
  const store = requestStore()
  const resolved = await resolveProductDeliveries(productIds, ctx)
  for (const [id, delivery] of resolved) store.map.set(id, delivery)
  store.prefetched = true
}

// The delivery for one product, served from the request batch when present.
// After a prefetch, an absent product is definitively "no service offered" (the
// batch map only holds products that resolved to at least one), so we never
// re-query for it. Without a prefetch we resolve just this product and cache the result so a
// repeat line for the same product is free.
export async function getProductDelivery(
  productId: string,
  ctx: ResolveContext,
): Promise<ProductDelivery | undefined> {
  const store = requestStore()
  const hit = store.map.get(productId)
  if (hit) return hit
  if (store.prefetched) return undefined
  const resolved = await resolveProductDeliveries([productId], ctx)
  const delivery = resolved.get(productId)
  if (delivery) store.map.set(productId, delivery)
  return delivery
}
