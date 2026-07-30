// Which product a storefront island is sitting on. Shop hands its server-side
// `_ctx` only to its own detail parts, so a block contributed by another module
// has to work the product out for itself - and the URL is the one thing every
// product page agrees on. Shared by the delivery-estimate line and the service
// picker so a change to shop's product URLs is a one-line change here.
export function slugFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const parts = window.location.pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('products')
  const slug = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1]
  return slug || null
}
