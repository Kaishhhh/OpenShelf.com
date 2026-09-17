import { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  addItem,
  clearCart,
  readCart,
  removeItem,
  setItem,
} from '../utils/cart.store.js';
import { buildCart } from '../utils/cart.builder.js';
import {
  cartAddItemSchema,
  cartUpdateItemSchema,
  MAX_CART_ITEMS,
  MAX_CART_QUANTITY,
  PRODUCT_NOT_AVAILABLE_MESSAGE,
  PRODUCT_NOT_PURCHASABLE_MESSAGE,
  parseOrThrow,
  parseProductId,
  requireUserId,
  type CartResponse,
} from '../utils/cart.helper.js';

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
 *
 * Two outcomes on purpose: anything not publicly visible is the uniform 404, while a
 * visible product whose seller cannot receive funds is a 400 — the catalogue already
 * says it is unpurchasable, so a distinct answer reveals nothing.
 */
async function requireBuyableProduct(productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      status: 'ACTIVE',
      shop: { is: { status: 'APPROVED' } },
    },
    select: {
      id: true,
      shop: { select: { seller: { select: { stripeChargesEnabled: true } } } },
    },
  });

  if (!product) {
    throw new NotFoundError(PRODUCT_NOT_AVAILABLE_MESSAGE);
  }
  if (product.shop.seller?.stripeChargesEnabled !== true) {
    throw new ValidationError(PRODUCT_NOT_PURCHASABLE_MESSAGE);
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
