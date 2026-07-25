// Loads the shared inputs the date engine needs - the shop timezone and the
// persisted holiday set for the configured region - so every caller (estimate
// API, storefront, cart resolver) builds them the same way.
import { prisma } from '@/lib/db/prisma'
import type { ResolveContext } from '@/modules/advanced-shipping-for-shop/lib/resolve'
import { getSettings } from '@/modules/advanced-shipping-for-shop/lib/db/settings'
import { getHolidaySet } from '@/modules/advanced-shipping-for-shop/lib/db/holidays'

// The site timezone, defaulting to Europe/London (this is a UK-shipping module)
// when there is no config row yet.
export async function getShopTimezone(): Promise<string> {
  const config = await prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { timezone: true } })
  return config?.timezone || 'Europe/London'
}

export async function getResolveContext(now: Date = new Date()): Promise<ResolveContext> {
  const settings = await getSettings()
  const [timezone, holidays] = await Promise.all([getShopTimezone(), getHolidaySet(settings.holidayRegion)])
  return { now, timezone, holidays }
}
