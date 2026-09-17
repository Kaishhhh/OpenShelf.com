import type { CartResponse } from './cart.helper.js';

/**
 * OpenShelf's cut of every order. A rate, applied per order rather than to the payment
 * total, so each seller's share is computable from their own order alone.
 */
export const PLATFORM_FEE_RATE = 0.1;

/** Every charge is in the platform's currency; transfers must match it. */
export const CHECKOUT_CURRENCY = 'usd';

/** Stripe refuses a USD charge below 50 cents. */
export const MIN_CHARGE_CENTS = 50;

/**
 * Dollars (the float Product.price is stored in) to cents. The one place that conversion
 * happens: everything downstream of checkout is integer arithmetic.
 */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** One line as it was priced at checkout — mirrors the PaymentLine composite type. */
export interface PricedLine {
  productId: string;
  shopId: string;
  title: string;
  /** Cents per unit. */
  price: number;
  quantity: number;
}

/**
 * The cart, as priced lines.
 *
 * Takes the assembled cart rather than raw products so checkout charges exactly what the
 * cart page showed — the effective price (salePrice when on sale), the clamped quantity,
 * and nothing that buildCart pruned.
 */
export function toPricedLines(cart: CartResponse): PricedLine[] {
  return cart.shops.flatMap((group) =>
    group.items.map((item) => ({
      productId: item.productId,
      shopId: group.shop.id,
      title: item.title,
      price: toCents(item.price),
      quantity: item.quantity,
    }))
  );
}

export function lineTotal(line: Pick<PricedLine, 'price' | 'quantity'>): number {
  return line.price * line.quantity;
}

/** Groups lines by shop, preserving first-seen order. One group becomes one Order. */
export function splitByShop(lines: PricedLine[]): Map<string, PricedLine[]> {
  const groups = new Map<string, PricedLine[]>();
  for (const line of lines) {
    const group = groups.get(line.shopId);
    if (group) {
      group.push(line);
    } else {
      groups.set(line.shopId, [line]);
    }
  }
  return groups;
}

export interface OrderSplit {
  subtotal: number;
  platformFee: number;
  sellerAmount: number;
}

/**
 * The fee is rounded once and the seller's share is what remains, so the two always sum
 * to the subtotal exactly — rounding both independently could lose or invent a cent.
 */
export function computeSplit(lines: PricedLine[]): OrderSplit {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const platformFee = Math.round(subtotal * PLATFORM_FEE_RATE);
  return { subtotal, platformFee, sellerAmount: subtotal - platformFee };
}
