import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { RulesScreen } from '@/modules/advanced-shipping-for-shop/components/admin/RulesScreen'

export const metadata = { title: 'Delivery rules — Admin' }

export default async function DeliveryRulesPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!(await hasShopPermission(user, 'shop.manage', { allowAccess: true }))) {
    return <div className="alert alert-danger">You do not have permission to manage delivery.</div>
  }
  return <RulesScreen />
}
