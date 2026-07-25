import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { SettingsScreen } from '@/modules/advanced-shipping-for-shop/components/admin/SettingsScreen'

export const metadata = { title: 'Delivery settings — Admin' }

export default async function DeliverySettingsPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!(await hasShopPermission(user, 'shop.manage', { allowAccess: true }))) {
    return <div className="alert alert-danger">You do not have permission to manage delivery.</div>
  }
  return <SettingsScreen />
}
