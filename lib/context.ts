// Loads the shared inputs the date engine needs - the shop timezone and the
// persisted holiday set for the configured region - so every caller (estimate
// API, storefront, cart resolver) builds them the same way.
import { prisma } from '@/lib/db/prisma'
import type { ResolveContext } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getSettingsCached } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { getHolidaySetCached } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'
import { ttlCached } from '@/modules/advanced-shipping-for-shop/lib/ttl-cache'

// The site timezone, defaulting to Europe/London (this is a UK-shipping module)
// when there is no config row yet. Cross-request TTL memo (a site's timezone
// effectively never changes): the context is rebuilt per request and this
// would otherwise re-query siteConfig every time.
const timezoneCache = ttlCached(async (): Promise<string> => {
  const config = await prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { timezone: true } })
  return config?.timezone || 'Europe/London'
}, 60_000)
export const getShopTimezone = (): Promise<string> => timezoneCache.get()

export async function getResolveContext(now: Date = new Date()): Promise<ResolveContext> {
  // Settings and timezone are independent; only the holiday set needs the
  // settings' region, so it alone waits on them. All three are TTL-cached, so
  // steady-state this whole context is built without touching the database.
  const [settings, timezone] = await Promise.all([getSettingsCached(), getShopTimezone()])
  const holidays = await getHolidaySetCached(settings.holidayRegion)
  return { now, timezone, holidays }
}
