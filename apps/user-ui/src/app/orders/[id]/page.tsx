'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BuyerOrder } from '@openshelf/types';
import { ApiError, getOrder } from '@/lib/api';
import { loginUrl } from '@/lib/return-to';
import { ORDERS_KEY } from '@/lib/use-orders';
import { SHORTFALL_NOTE, STATUS_LABELS } from '@/components/OrderCard';
import { formatCents } from '@/components/Price';
import { EmptyState } from '@/components/ProductGrid';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface Step {
  label: string;
  at: string | null;
}

/**
 * The path this order has taken, and the steps still ahead of it.
 *
 * A cancelled order's path ends at Cancelled; the shipping steps it never reached are not
 * shown as pending, because they never will be.
 */
function timeline(order: BuyerOrder): Step[] {
  const paid = { label: 'Paid', at: order.createdAt };
  if (order.status === 'CANCELLED') {
    return [paid, { label: 'Cancelled', at: order.cancelledAt }];
  }
  return [
    paid,
    { label: 'Shipped', at: order.shippedAt },
    { label: 'Delivered', at: order.deliveredAt },
  ];
}

function Timeline({ order }: { order: BuyerOrder }) {
  return (
    <ol className="flex flex-col gap-2">
      {timeline(order).map((step) => {
        const done = step.at !== null;
        return (
          <li key={step.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
                done ? 'border-accent bg-accent' : 'border-line bg-surface'
              }`}
            />
            <span className={done ? 'text-ink' : 'text-ink-muted'}>{step.label}</span>
            <span className="ml-auto text-xs text-ink-muted">
              {step.at ? formatDate(step.at) : 'Not yet'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const { data: order, error, isPending } = useQuery<BuyerOrder, ApiError>({
    queryKey: [...ORDERS_KEY, 'detail', id],
    queryFn: () => getOrder(id),
    retry: false,
  });

  const anonymous = error?.status === 401;

  useEffect(() => {
    if (anonymous) {
      router.replace(loginUrl(`/orders/${id}`));
    }
  }, [anonymous, id, router]);

  if (isPending || anonymous) {
    return null;
  }

  // Someone else's order and an id that never existed are the same 404 upstream, and
  // the same message here.
  if (error?.status === 404) {
    return (
      <div className="flex flex-col gap-2">
        <EmptyState message="Order not found." />
        <a href="/orders" className="text-sm text-accent">
          Back to your orders
        </a>
      </div>
    );
  }

  if (error || !order) {
    return <EmptyState message="This order could not be loaded. This is usually temporary." />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <a href="/orders" className="text-xs text-ink-muted hover:text-ink">
          ← Your orders
        </a>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold text-ink">Order from {order.shop.name}</h1>
          <span className="rounded-card border border-line px-1.5 py-0.5 text-xs text-ink-muted">
            {STATUS_LABELS[order.status]}
          </span>
        </div>
        <p className="text-sm text-ink-muted">Paid on {formatDate(order.createdAt)}</p>
      </div>

      {order.stockShortfall && (
        <p className="rounded-card border border-line bg-line/30 p-3 text-sm text-ink">
          {SHORTFALL_NOTE}
        </p>
      )}

      <section className="rounded-card border border-line bg-surface p-3">
        <Timeline order={order} />
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3">
        <a
          href={`/shops/${order.shop.id}`}
          className="text-sm font-medium text-ink hover:text-accent"
        >
          {order.shop.name}
        </a>

        <ul className="flex flex-col">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex gap-3 border-t border-line py-3 first:border-t-0 first:pt-0"
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-card border border-line bg-line/30">
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
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm text-ink" title={item.title}>
                  {item.title}
                </span>
                <span className="text-xs text-ink-muted">
                  {item.quantity} × {formatCents(item.price)}
                </span>
                {item.stockShortfall && (
                  <span className="text-xs text-ink-muted">May be delayed</span>
                )}
              </div>
              <span className="shrink-0 text-sm text-ink">{formatCents(item.lineTotal)}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-ink-muted">Total</span>
          <span className="font-semibold text-ink">{formatCents(order.subtotal)}</span>
        </div>
      </section>
    </div>
  );
}
