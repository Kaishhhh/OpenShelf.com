import { z } from 'zod';

/**
 * Bounds on a cart, kept here rather than in order-service so the UI can render the
 * same limits it will be held to.
 */
export const MAX_CART_QUANTITY = 99;
export const MAX_CART_ITEMS = 50;

// The same guard publicProductListQuerySchema uses on shopId: Prisma raises P2023 for
// anything that is not 24 hex characters, which would surface as a 500.
const productId = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{24}$/i, 'Invalid product id');

const quantity = z
  .number()
  .int('Quantity must be a whole number')
  .min(1, 'Quantity must be at least 1')
  .max(MAX_CART_QUANTITY, `Quantity cannot exceed ${MAX_CART_QUANTITY}`);

/**
 * POST /order/cart/items — adds to whatever quantity is already there.
 *
 * `quantity` defaults to 1 so a product page's button can post just the id.
 */
export const cartAddItemSchema = z
  .object({ productId, quantity: quantity.default(1) })
  .strict();

export type CartAddItemInput = z.infer<typeof cartAddItemSchema>;

/** PATCH /order/cart/items/:productId — sets the quantity absolutely. */
export const cartUpdateItemSchema = z.object({ quantity }).strict();

export type CartUpdateItemInput = z.infer<typeof cartUpdateItemSchema>;

/**
 * A single line, assembled fresh on every read.
 *
 * Redis holds only productId and quantity — everything else here comes from the
 * database at request time, which is what makes a stale price structurally impossible
 * rather than something to remember.
 */
export interface CartItem {
  productId: string;
  slug: string;
  title: string;
  image: string | null;
  /** What the buyer pays: salePrice when there is one, otherwise price. */
  price: number;
  /** The undiscounted price, present only when the product is on sale. */
  originalPrice: number | null;
  quantity: number;
  stock: number;
  lineTotal: number;
}

export interface CartShopGroup {
  shop: { id: string; name: string };
  items: CartItem[];
  subtotal: number;
}

/**
 * Why the cart the buyer sees differs from the one they left.
 *
 * `removed` items are gone from storage too; `clamped` ones are not — see the cart
 * store for why stock is reported but never persisted.
 */
export interface CartNotice {
  type: 'removed' | 'clamped';
  title: string;
  /** Present on a clamp: what the quantity was reduced to. */
  quantity?: number;
}

export interface CartResponse {
  shops: CartShopGroup[];
  total: number;
  /** Sum of quantities — what the header badge renders. */
  itemCount: number;
  distinctItems: number;
  notices: CartNotice[];
}
