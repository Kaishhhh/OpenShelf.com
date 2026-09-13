import { redis } from '@openshelf/redis';

/**
 * The cart's storage layer.
 *
 * **Redis holds only productId -> quantity.** No price, no title, no image. Every read
 * re-fetches the product from MongoDB, so a price the seller changed after the item went
 * in the cart can never be the price shown at checkout. Caching the price here would
 * make that failure silent and nearly untestable, which is precisely why this module
 * exposes no way to store one.
 *
 * A hash rather than the JSON string the rest of the repo uses for Redis values
 * (`pending_reg` and friends): HSET/HDEL are atomic per item and the distinct-item cap
 * is a single HLEN, where a blob would force read-modify-write on every mutation. A
 * deliberate deviation from the house idiom, noted here because it is one.
 */

export const CART_TTL_SECONDS = 30 * 24 * 60 * 60;

export const cartKey = (userId: string) => `cart:${userId}`;

/** The stored cart: productId -> quantity, in insertion order. */
export async function readCart(userId: string): Promise<Map<string, number>> {
  const raw = await redis.hgetall(cartKey(userId));
  const items = new Map<string, number>();

  for (const [productId, value] of Object.entries(raw)) {
    const quantity = Number(value);
    // A non-numeric or non-positive field can only come from manual tampering with
    // the key. Skipping rather than throwing keeps one bad field from breaking the
    // whole cart; the prune in the controller drops it on the next write.
    if (Number.isInteger(quantity) && quantity > 0) {
      items.set(productId, quantity);
    }
  }

  return items;
}

/**
 * Every write refreshes the 30-day window, so an actively used cart never expires.
 * Kept in one place so no mutation can forget it.
 */
async function touch(userId: string): Promise<void> {
  await redis.expire(cartKey(userId), CART_TTL_SECONDS);
}

/** Sets a quantity absolutely. Returns the value stored. */
export async function setItem(
  userId: string,
  productId: string,
  quantity: number
): Promise<number> {
  await redis.hset(cartKey(userId), productId, String(quantity));
  await touch(userId);
  return quantity;
}

/**
 * Adds to the existing quantity, saturating at `max` rather than rejecting — a buyer
 * clicking "add" on a product they already have 99 of wants a full cart, not an error.
 *
 * HINCRBY is atomic, so two concurrent adds cannot lose one another; the clamp that
 * follows is a second round trip, which at worst briefly overshoots for a buyer racing
 * themselves across two tabs.
 */
export async function addItem(
  userId: string,
  productId: string,
  quantity: number,
  max: number
): Promise<number> {
  const total = await redis.hincrby(cartKey(userId), productId, quantity);
  await touch(userId);

  if (total > max) {
    return setItem(userId, productId, max);
  }
  return total;
}

export async function removeItem(
  userId: string,
  productId: string
): Promise<boolean> {
  const removed = await redis.hdel(cartKey(userId), productId);
  await touch(userId);
  return removed > 0;
}

/** Drops several items at once — used by the prune inside a read. */
export async function removeItems(
  userId: string,
  productIds: string[]
): Promise<void> {
  if (productIds.length === 0) {
    return;
  }
  await redis.hdel(cartKey(userId), ...productIds);
  await touch(userId);
}

export async function clearCart(userId: string): Promise<void> {
  await redis.del(cartKey(userId));
}
