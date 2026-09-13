import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  addItem,
  clearCart,
  readCart,
  removeItem,
  removeItems,
  setItem,
} from '../utils/cart.store.js';
import {
  cartAddItemSchema,
  cartUpdateItemSchema,
  MAX_CART_ITEMS,
  MAX_CART_QUANTITY,
  PRODUCT_NOT_AVAILABLE_MESSAGE,
  parseOrThrow,
  parseProductId,
  requireUserId,
  type CartItem,
  type CartNotice,
  type CartResponse,
  type CartShopGroup,
} from '../utils/cart.helper.js';

/**
 * Everything the cart renders, read fresh on every request.
 *
 * `status` and `shop.status` are selected so this function — not the caller — decides
 * what is still buyable. Only the first image is taken: the cart shows a thumbnail.
 */
const CART_PRODUCT_SELECT = {
  id: true,
  title: true,
  slug: true,
  price: true,
  salePrice: true,
  stock: true,
  status: true,
  shop: { select: { id: true, name: true, status: true } },
  images: { select: { url: true }, take: 1 },
} as const;

/** Money is assembled from floats, so round once at each boundary. */
const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Turns the stored `productId -> quantity` map into the response.
 *
 * Two rules differ deliberately:
 *
 * - A product that is no longer ACTIVE, or whose shop is no longer APPROVED, is
 *   **deleted from storage** as it is reported. The notice fires once and the cart
 *   heals itself.
 * - A quantity above stock is **reported but not persisted**. Stock is transient — a
 *   restock should restore the buyer's original quantity rather than having silently
 *   shrunk it behind their back.
 */
async function buildCart(
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
      product.shop.status !== 'APPROVED'
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

/** Reads storage and assembles — the shared tail of every handler below. */
async function respondWithCart(userId: string, res: Response) {
  const cart = await buildCart(userId, await readCart(userId));
  return res.status(200).json(cart);
}

/**
 * The product a write is allowed to put in a cart.
 *
 * Validated before storing so an unbuyable id never reaches Redis in the first place —
 * the prune inside a read is a safety net for products that change *after* they were
 * added, not the primary gate.
 */
async function requireBuyableProduct(productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      status: 'ACTIVE',
      shop: { is: { status: 'APPROVED' } },
    },
    select: { id: true },
  });

  if (!product) {
    throw new NotFoundError(PRODUCT_NOT_AVAILABLE_MESSAGE);
  }
}

export async function getCart(req: Request, res: Response) {
  return respondWithCart(requireUserId(req), res);
}

export async function addCartItem(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { productId, quantity } = parseOrThrow(cartAddItemSchema, req.body);

  await requireBuyableProduct(productId);

  // Only a *new* line can breach the cap, so an item already in the cart is always
  // addable.
  const stored = await readCart(userId);
  if (!stored.has(productId) && stored.size >= MAX_CART_ITEMS) {
    throw new ValidationError(
      `A cart can hold at most ${MAX_CART_ITEMS} different products`
    );
  }

  await addItem(userId, productId, quantity, MAX_CART_QUANTITY);

  return respondWithCart(userId, res);
}

export async function updateCartItem(req: Request, res: Response) {
  const userId = requireUserId(req);
  const productId = parseProductId(req.params.productId);
  const { quantity } = parseOrThrow(cartUpdateItemSchema, req.body);

  const stored = await readCart(userId);
  if (!stored.has(productId)) {
    throw new NotFoundError('Item not in cart');
  }
  // Must still be buyable: raising the quantity on a product that was withdrawn
  // behaves like adding it back, which is a 404.
  await requireBuyableProduct(productId);

  await setItem(userId, productId, quantity);

  return respondWithCart(userId, res);
}

export async function deleteCartItem(req: Request, res: Response) {
  const userId = requireUserId(req);
  const productId = parseProductId(req.params.productId);

  const removed = await removeItem(userId, productId);
  if (!removed) {
    throw new NotFoundError('Item not in cart');
  }

  return respondWithCart(userId, res);
}

export async function deleteCart(req: Request, res: Response) {
  const userId = requireUserId(req);
  await clearCart(userId);

  // Answering with the same shape every other handler returns, rather than a 204, so
  // the client can drop it straight into the ['cart'] query like any other mutation.
  return res.status(200).json({
    shops: [],
    total: 0,
    itemCount: 0,
    distinctItems: 0,
    notices: [],
  } satisfies CartResponse);
}
