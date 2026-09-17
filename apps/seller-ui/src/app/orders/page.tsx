'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ORDER_STATUSES, type OrderStatus } from '@openshelf/types';
import { Button } from '@openshelf/ui';
import { ApiError, listShopOrders, type SellerOrderPage } from '@/lib/api';
import { STATUS_LABELS, formatCents, formatDate } from '@/lib/orders';
import { useApprovedShop } from '@/lib/use-approved-shop';

const FILTERS: { label: string; status?: OrderStatus }[] = [
  { label: 'All' },
  { label: 'Awaiting shipment', status: 'PAID' },
  { label: 'Shipped', status: 'SHIPPED' },
  { label: 'Delivered', status: 'DELIVERED' },
  { label: 'Cancelled', status: 'CANCELLED' },
];

function parseStatus(value: string | null): OrderStatus | undefined {
  return ORDER_STATUSES.find((s) => s === value);
}

function OrderList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Filter and page live in the URL, so the dashboard can link straight to a filter and
  // a reload keeps the seller where they were.
  const status = parseStatus(searchParams.get('status'));
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const { data, error, isPending } = useQuery<SellerOrderPage, ApiError>({
    queryKey: ['shop-orders', status ?? 'ALL', page],
    queryFn: () => listShopOrders({ status, page }),
  });

  function go(next: { status?: OrderStatus; page?: number }) {
    const query = new URLSearchParams();
    if (next.status) query.set('status', next.status);
    if (next.page && next.page > 1) query.set('page', String(next.page));
    const qs = query.toString();
    router.push(`/orders${qs ? `?${qs}` : ''}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-ink">Orders</h1>
        <a href="/dashboard" className="text-sm text-accent">
          Back to dashboard
        </a>
      </div>

      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = filter.status === status;
          return (
            <button
              key={filter.label}
              type="button"
              onClick={() => go({ status: filter.status })}
              className={`rounded-card border px-2 py-1 text-xs ${
                active
                  ? 'border-accent bg-accent text-surface'
                  : 'border-line text-ink-muted hover:text-ink'
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </nav>

      {isPending ? null : error ? (
        <p className="rounded-card border border-line bg-surface p-6 text-sm text-danger">
          {error.message}
        </p>
      ) : data.orders.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-6 text-sm text-ink-muted">
          {status ? 'No orders with this status.' : 'No orders yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="p-3 font-medium">Order</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Items</th>
                <th className="p-3 text-right font-medium">Subtotal</th>
                <th className="p-3 text-right font-medium">You receive</th>
              </tr>
            </thead>
            <tbody>
              {/* Already ordered stock-shortfall first by the server. */}
              {data.orders.map((order) => (
                <tr key={order.id} className="border-b border-line last:border-0">
                  <td className="p-3">
                    <a href={`/orders/${order.id}`} className="flex flex-col text-accent">
                      <span>{order.buyer.name}</span>
                      <span className="text-xs text-ink-muted">{formatDate(order.createdAt)}</span>
                    </a>
                    {order.stockShortfall && (
                      <span className="mt-1 inline-block rounded-card border border-danger px-1.5 py-0.5 text-xs text-danger">
                        Stock short
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-ink">{STATUS_LABELS[order.status]}</td>
                  <td className="p-3 text-ink">
                    {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                  </td>
                  <td className="p-3 text-right text-ink">{formatCents(order.subtotal)}</td>
                  <td className="p-3 text-right text-ink">{formatCents(order.sellerAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => go({ status, page: page - 1 })}
          >
            Previous
          </Button>
          <span>
            Page {data.page} of {data.totalPages} — {data.total} total
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => go({ status, page: page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { ready } = useApprovedShop();
  if (!ready) {
    return null;
  }
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <OrderList />
    </Suspense>
  );
}
