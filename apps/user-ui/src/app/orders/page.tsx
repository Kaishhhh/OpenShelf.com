'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { BuyerOrder } from '@openshelf/types';
import { Button } from '@openshelf/ui';
import { OrderCard } from '@/components/OrderCard';
import { formatCents } from '@/components/Price';
import { EmptyState } from '@/components/ProductGrid';
import { loginUrl } from '@/lib/return-to';
import { useOrders } from '@/lib/use-orders';

interface Checkout {
  paymentIntentId: string;
  createdAt: string;
  orders: BuyerOrder[];
}

/**
 * Orders from one checkout share a payment, so they are shown together — the buyer paid
 * once for them. Grouped within the page only: a checkout whose orders straddle a page
 * boundary shows on both pages, which is rare enough not to warrant paging by payment.
 */
function groupByCheckout(orders: BuyerOrder[]): Checkout[] {
  const groups = new Map<string, Checkout>();
  for (const order of orders) {
    const group = groups.get(order.paymentIntentId);
    if (group) {
      group.orders.push(order);
    } else {
      groups.set(order.paymentIntentId, {
        paymentIntentId: order.paymentIntentId,
        createdAt: order.createdAt,
        orders: [order],
      });
    }
  }
  return [...groups.values()];
}

export default function OrdersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isPending, anonymous, error } = useOrders(page);

  useEffect(() => {
    if (anonymous) {
      router.replace(loginUrl('/orders'));
    }
  }, [anonymous, router]);

  if (isPending || anonymous) {
    return null;
  }

  if (error || !data) {
    return <EmptyState message="Your orders could not be loaded. This is usually temporary." />;
  }

  if (data.orders.length === 0) {
    return <EmptyState message="You have no orders yet." />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-lg font-semibold text-ink">Your orders</h1>

      {groupByCheckout(data.orders).map((checkout) => (
        <div key={checkout.paymentIntentId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ink">
              {new Date(checkout.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="text-ink-muted">
              {formatCents(checkout.orders.reduce((sum, o) => sum + o.subtotal, 0))}
            </span>
          </div>
          {checkout.orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      ))}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
