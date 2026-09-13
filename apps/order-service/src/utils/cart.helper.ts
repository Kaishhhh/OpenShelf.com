import { z } from 'zod';
import { AuthError, NotFoundError, ValidationError } from '@openshelf/errors';
import type { Request } from 'express';

export {
  cartAddItemSchema,
  cartUpdateItemSchema,
  MAX_CART_ITEMS,
  MAX_CART_QUANTITY,
  type CartAddItemInput,
  type CartItem,
  type CartNotice,
  type CartResponse,
  type CartShopGroup,
  type CartUpdateItemInput,
} from '@openshelf/types';

/**
 * One message for "no such product" and for "exists but is not buyable".
 *
 * A DRAFT product and a product from a PENDING shop both land here, identical to a
 * fabricated id — the same convention the public catalogue already uses, so nothing
 * here confirms that an unpublished product exists.
 */
export const PRODUCT_NOT_AVAILABLE_MESSAGE = 'Product not available';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.issues);
  }
  return result.data;
}

/**
 * Prisma raises P2023 for an id that is not 24 hex characters, which would surface as a
 * 500. Rejecting up front keeps every unavailable outcome a uniform 404.
 */
export function parseProductId(raw: unknown): string {
  const id = String(raw ?? '');
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new NotFoundError(PRODUCT_NOT_AVAILABLE_MESSAGE);
  }
  return id;
}

/**
 * The cart key's owner.
 *
 * `isAuthenticated` guarantees req.user, but it is optional on the Express type; this
 * turns that into a checked narrowing rather than a non-null assertion.
 */
export function requireUserId(req: Request): string {
  const user = req.user;
  if (!user) {
    throw new AuthError('Not authenticated');
  }
  return user.id;
}
