import { prisma } from '@openshelf/prisma';
import { removeItems } from './cart.store.js';
import type {
  CartItem,
  CartNotice,
  CartResponse,
  CartShopGroup,
} from './cart.helper.js';

/**
 * Everything the cart renders, read fresh on every request.
 *
 * `status`, `shop.status` and the seller's charges flag are selected so this function —
 * not the caller — decides what is still buyable. The seller flag is the only seller
 * field read, and it never reaches the response. Only the first image is taken: the
 * cart shows a thumbnail.
 */
const CART_PRODUCT_SELECT = {
  id: true,
  title: true,
  slug: true,
  price: true,
  salePrice: true,
  stock: true,
  status: true,
  shop: {
    select: {
      id: true,
      name: true,
      status: true,
      seller: { select: { stripeChargesEnabled: true } },
    },
  },
  images: { select: { url: true }, take: 1 },
} as const;

/** Money is assembled from floats, so round once at each boundary. */
const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Turns the stored `productId -> quantity` map into the response.
 *
 * Two rules differ deliberately:
 *
 * - A product that is no longer ACTIVE, whose shop is no longer APPROVED, or whose
 *   seller can no longer receive funds, is **deleted from storage** as it is reported. The notice fires once and the cart
 *   heals itself.
 * - A quantity above stock is **reported but not persisted**. Stock is transient — a
 *   restock should restore the buyer's original quantity rather than having silently
 *   shrunk it behind their back.
 */
export async function buildCart(
  userId: string,
  stored: Map<string, number>
): Promise<CartResponse> {
  const notices: CartNotice[] = [];

  if (stored.size === 0) {
    return { shops: [], total: 0, itemCount: 0, distinctItems: 0, notices };
  }

  // One query for the whole cart, not one per line.
  const products = await prisma.product.findMany({
    where: { id: { in: [...stored.keys()] } },
    select: CART_PRODUCT_SELECT,
  });

  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, CartShopGroup>();
  const gone: string[] = [];
  let total = 0;
  let itemCount = 0;
  let distinctItems = 0;

  // Iterating the stored map rather than the query result preserves insertion order
  // and catches ids the query returned nothing for (a hard-deleted product).
  for (const [productId, quantity] of stored) {
    const product = byId.get(productId);

    if (
      !product ||
      product.status !== 'ACTIVE' ||
      product.shop.status !== 'APPROVED' ||
      // Live, not snapshotted at add time: Stripe can restrict an account while the
      // item sits in the cart. `!== true` fails closed on an unset field.
      product.shop.seller?.stripeChargesEnabled !== true
    ) {
      gone.push(productId);
      // A product the query did not return has no title to report. "An item" is
      // vague, but inventing one would be worse and it is a genuinely rare case.
      notices.push({ type: 'removed', title: product?.title ?? 'An item' });
      continue;
    }

    const effective = quantity > product.stock ? product.stock : quantity;

    if (effective === 0) {
      // Out of stock entirely. Kept in storage — unlike a removal this is temporary,
      // and the buyer gets it back when the seller restocks.
      notices.push({ type: 'clamped', title: product.title, quantity: 0 });
      distinctItems += 1;
      continue;
    }

    if (effective !== quantity) {
      notices.push({
        type: 'clamped',
        title: product.title,
        quantity: effective,
      });
    }

    const onSale =
      product.salePrice !== null && product.salePrice < product.price;
    const price = onSale ? (product.salePrice as number) : product.price;
    const lineTotal = money(price * effective);

    const item: CartItem = {
      productId,
      slug: product.slug,
      title: product.title,
      image: product.images[0]?.url ?? null,
      price,
      originalPrice: onSale ? product.price : null,
      quantity: effective,
      stock: product.stock,
      lineTotal,
    };

    let group = groups.get(product.shop.id);
    if (!group) {
      group = {
        shop: { id: product.shop.id, name: product.shop.name },
        items: [],
        subtotal: 0,
      };
      groups.set(product.shop.id, group);
    }
    group.items.push(item);
    group.subtotal = money(group.subtotal + lineTotal);

    total = money(total + lineTotal);
    itemCount += effective;
    distinctItems += 1;
  }

  // The prune. Done after the loop so it is one round trip regardless of cart size.
  await removeItems(userId, gone);

  return {
    shops: [...groups.values()],
    total,
    itemCount,
    distinctItems,
    notices,
  };
}
