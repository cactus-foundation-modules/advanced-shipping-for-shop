import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { HolidaysScreen } from '@/modules/advanced-shipping-for-shop/components/admin/HolidaysScreen'

export const metadata = { title: 'Delivery holidays — Admin' }

export default async function DeliveryHolidaysPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!(await hasShopPermission(user, 'shop.manage', { allowAccess: true }))) {
    return <div className="alert alert-danger">You do not have permission to manage delivery.</div>
  }
  return <HolidaysScreen />
}
