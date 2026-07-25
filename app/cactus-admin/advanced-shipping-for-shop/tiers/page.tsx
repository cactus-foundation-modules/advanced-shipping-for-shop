import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { TiersScreen } from '@/modules/advanced-shipping-for-shop/components/admin/TiersScreen'

export const metadata = { title: 'Service tiers — Admin' }

export default async function ServiceTiersPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!(await hasShopPermission(user, 'shop.manage', { allowAccess: true }))) {
    return <div className="alert alert-danger">You do not have permission to manage delivery.</div>
  }
  return <TiersScreen />
}
