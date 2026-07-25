// The Delivery tab on the shop product editor, contributed through the
// shop.product-editor-sections point. Hands off to the client editor, which
// loads this product's override and saves it with its own button.
import { ProductDeliveryEditor } from '@/modules/advanced-shipping-for-shop/components/admin/ProductDeliveryEditor'

export function ProductDeliverySection({ productId }: { productId: string }) {
  return <ProductDeliveryEditor productId={productId} />
}
