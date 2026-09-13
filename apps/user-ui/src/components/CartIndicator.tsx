'use client';

import { useCart } from '@/lib/use-cart';

/**
 * The header's cart link, on every page because it lives in the root layout.
 *
 * It reads the same ['cart'] query every mutation writes to, so adding an item on a
 * product page updates the badge here with no refetch and no extra endpoint.
 *
 * An anonymous visitor gets the link with no badge — there is no anonymous cart, and a
 * 401 here is an ordinary answer rather than something to surface.
 */
export function CartIndicator() {
  const { data, isPending } = useCart();

  // isPending covers the first load: rendering a 0 before the answer arrives would
  // flash an empty cart at someone who has items.
  const count = isPending ? 0 : data?.itemCount ?? 0;

  return (
    <a
      href="/cart"
      className="relative flex items-center gap-1 hover:text-ink"
      aria-label={count > 0 ? `Cart, ${count} items` : 'Cart'}
    >
      <span aria-hidden>Cart</span>
      {count > 0 && (
        <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-surface">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </a>
  );
}
