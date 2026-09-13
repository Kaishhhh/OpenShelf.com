'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { CartItem, CartNotice } from '@openshelf/types';
import { Button } from '@openshelf/ui';
import { loginUrl } from '@/lib/return-to';
import {
  useCart,
  useClearCart,
  useRemoveCartItem,
  useUpdateCartItem,
} from '@/lib/use-cart';
import { formatMoney, Price } from '@/components/Price';
import { EmptyState } from '@/components/ProductGrid';

/**
 * Why the cart changed since the buyer last looked.
 *
 * Removals have already been applied in storage by the time this renders; clamps have
 * not, which is why a clamped line still shows its real stored quantity waiting on a
 * restock rather than a permanently reduced one.
 */
function Notices({ notices }: { notices: CartNotice[] }) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col gap-1 rounded-card border border-line bg-line/30 p-3 text-sm text-ink-muted">
      {notices.map((notice, index) => (
        <li key={`${notice.title}-${index}`}>
          {notice.type === 'removed'
            ? `${notice.title} is no longer available and was removed from your cart.`
            : notice.quantity === 0
            ? `${notice.title} is out of stock right now.`
            : `Only ${notice.quantity} of ${notice.title} left — your quantity was reduced.`}
        </li>
      ))}
    </ul>
  );
}

function CartLine({ item }: { item: CartItem }) {
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const busy = update.isPending || remove.isPending;

  return (
    <li className="flex gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
      <a
        href={`/products/${item.slug}`}
        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-card border border-line bg-line/30"
      >
        {item.image ? (
          <Image
            src={item.image}
            alt={item.title}
            fill
            sizes="64px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-[10px] text-ink-muted">
            No photo
          </span>
        )}
      </a>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <a
          href={`/products/${item.slug}`}
          className="truncate text-sm text-ink hover:text-accent"
          title={item.title}
        >
          {item.title}
        </a>
        <Price
          price={item.originalPrice ?? item.price}
          salePrice={item.originalPrice === null ? null : item.price}
          className="text-sm"
        />

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`qty-${item.productId}`}>
            Quantity
          </label>
          <select
            id={`qty-${item.productId}`}
            value={item.quantity}
            disabled={busy}
            onChange={(e) =>
              update.mutate({
                productId: item.productId,
                quantity: Number(e.target.value),
              })
            }
            className="rounded-card border border-line bg-surface px-1.5 py-1 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
          >
            {/* Capped at the stock the server just reported, so the control cannot
                offer a quantity the server would clamp back down. */}
            {Array.from(
              { length: Math.min(item.stock, 99) },
              (_, i) => i + 1
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={busy}
            onClick={() => remove.mutate(item.productId)}
            className="text-xs text-ink-muted hover:text-danger disabled:opacity-50"
          >
            Remove
          </button>
        </div>

        {(update.isError || remove.isError) && (
          <p className="text-xs text-danger">
            {(update.error ?? remove.error)?.message}
          </p>
        )}
      </div>

      <span className="shrink-0 text-sm text-ink">
        {formatMoney(item.lineTotal)}
      </span>
    </li>
  );
}

export default function CartPage() {
  const router = useRouter();
  const { data, isPending, anonymous, error } = useCart();
  const clear = useClearCart();

  // Redirect in an effect, never during render. Anonymous is the only case that
  // leaves this page — every other error stays and explains itself.
  useEffect(() => {
    if (anonymous) {
      router.replace(loginUrl('/cart'));
    }
  }, [anonymous, router]);

  if (isPending || anonymous) {
    return null;
  }

  if (error || !data) {
    return (
      <EmptyState message="Your cart could not be loaded. This is usually temporary." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">Your cart</h1>

      <Notices notices={data.notices} />

      {data.shops.length === 0 ? (
        <EmptyState message="Your cart is empty." />
      ) : (
        <>
          {/* Grouped by shop because each vendor is paid separately — the split
              checkout this is heading towards needs exactly this shape. */}
          {data.shops.map((group) => (
            <section
              key={group.shop.id}
              className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
            >
              <div className="flex items-baseline justify-between">
                <a
                  href={`/shops/${group.shop.id}`}
                  className="text-sm font-medium text-ink hover:text-accent"
                >
                  {group.shop.name}
                </a>
                <span className="text-sm text-ink-muted">
                  Subtotal {formatMoney(group.subtotal)}
                </span>
              </div>

              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <CartLine key={item.productId} item={item} />
                ))}
              </ul>
            </section>
          ))}

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-muted">
                {data.itemCount} item{data.itemCount === 1 ? '' : 's'} from{' '}
                {data.shops.length} shop{data.shops.length === 1 ? '' : 's'}
              </span>
              <span className="text-lg font-semibold text-ink">
                {formatMoney(data.total)}
              </span>
            </div>

            <div className="flex gap-2">
              {/* Checkout is the next slice — disabled rather than absent so the
                  page reads complete, and so it cannot imply a capability that
                  does not exist yet. */}
              <Button type="button" disabled title="Coming soon">
                Checkout
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={clear.isPending}
                onClick={() => clear.mutate()}
              >
                Empty cart
              </Button>
            </div>

            {clear.isError && (
              <p className="text-xs text-danger">{clear.error.message}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
