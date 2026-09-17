'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { nextStatuses, type OrderStatus } from '@openshelf/types';
import { Button } from '@openshelf/ui';
import {
  ApiError,
  getShopOrder,
  updateOrderStatus,
  type SellerOrder,
} from '@/lib/api';
import {
  ACTION_LABELS,
  STATUS_LABELS,
  TRANSFER_LABELS,
  formatCents,
  formatDate,
} from '@/lib/orders';
import { useApprovedShop } from '@/lib/use-approved-shop';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</span>
    </div>
  );
}

/**
 * One button per transition the shared state machine allows from the current status —
 * so an illegal move has no button at all. The server enforces the same table; a stale
 * page that offers an outdated move gets its 400 shown here.
 */
function StatusControl({ order }: { order: SellerOrder }) {
  const queryClient = useQueryClient();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [refundNotice, setRefundNotice] = useState(false);

  const update = useMutation({
    mutationFn: (status: OrderStatus) => updateOrderStatus(order.id, status),
    onSuccess: ({ order: updated, refundRequired }) => {
      queryClient.setQueryData(['shop-order', order.id], updated);
      queryClient.invalidateQueries({ queryKey: ['shop-orders'] });
      setConfirmingCancel(false);
      setRefundNotice(refundRequired);
    },
    onError: () => {
      // Whatever the page believed, re-read the truth.
      queryClient.invalidateQueries({ queryKey: ['shop-order', order.id] });
    },
  });

  const moves = nextStatuses(order.status);

  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Status</h2>
      <p className="text-sm text-ink">{STATUS_LABELS[order.status]}</p>

      {moves.length === 0 ? (
        <p className="text-xs text-ink-muted">This order is complete; its status can no longer change.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {moves
            .filter((to) => to !== 'CANCELLED')
            .map((to) => (
              <Button
                key={to}
                type="button"
                loading={update.isPending && update.variables === to}
                disabled={update.isPending}
                onClick={() => update.mutate(to)}
              >
                {ACTION_LABELS[to] ?? to}
              </Button>
            ))}

          {moves.includes('CANCELLED') &&
            (confirmingCancel ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">
                  Cancel this order? This cannot be undone, and the buyer is not refunded
                  automatically.
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  loading={update.isPending && update.variables === 'CANCELLED'}
                  onClick={() => update.mutate('CANCELLED')}
                >
                  Yes, cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingCancel(false)}
                >
                  Keep
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={update.isPending}
                onClick={() => setConfirmingCancel(true)}
              >
                {ACTION_LABELS.CANCELLED}
              </Button>
            ))}
        </div>
      )}

      {update.isError && (
        <p className="text-sm text-danger">{(update.error as ApiError).message}</p>
      )}

      {/* Refunds are not implemented: cancelling records the decision, nothing more. */}
      {(refundNotice || order.status === 'CANCELLED') && (
        <p className="text-xs text-ink-muted">
          Refunds are not processed automatically yet. The buyer has paid for this order.
        </p>
      )}
    </section>
  );
}

export default function ShopOrderPage() {
  const { ready } = useApprovedShop();
  const { id } = useParams<{ id: string }>();

  const { data: order, error, isPending } = useQuery<SellerOrder, ApiError>({
    queryKey: ['shop-order', id],
    queryFn: () => getShopOrder(id),
    retry: false,
    enabled: ready,
  });

  if (!ready || isPending) {
    return null;
  }

  if (error || !order) {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
        <h1 className="text-base font-semibold text-ink">
          {error?.status === 404 ? 'Order not found' : 'Something went wrong'}
        </h1>
        {error && error.status !== 404 && <p className="text-sm text-danger">{error.message}</p>}
        <p className="text-sm">
          <a href="/orders" className="text-accent">
            Back to orders
          </a>
        </p>
      </div>
    );
  }

  const steps: { label: string; at: string | null }[] = [
    { label: 'Paid', at: order.createdAt },
    ...(order.status === 'CANCELLED'
      ? [{ label: 'Cancelled', at: order.cancelledAt }]
      : [
          { label: 'Shipped', at: order.shippedAt },
          { label: 'Delivered', at: order.deliveredAt },
        ]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <a href="/orders" className="text-xs text-ink-muted hover:text-ink">
          ← Orders
        </a>
        <h1 className="text-base font-semibold text-ink">Order for {order.buyer.name}</h1>
        <p className="text-sm text-ink-muted">Paid on {formatDate(order.createdAt)}</p>
      </div>

      {order.stockShortfall && (
        <p className="rounded-card border border-danger bg-surface p-3 text-sm text-danger">
          Stock short: at least one item below could not be taken from stock when this order
          was paid. The buyer has been told it may be delayed.
        </p>
      )}

      <StatusControl order={order} />

      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        <ul className="flex flex-col">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 border-t border-line py-2 first:border-t-0"
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt=""
                  className="h-10 w-10 rounded-card border border-line object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-card border border-line text-xs text-ink-muted">
                  —
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-ink">{item.title}</span>
                <span className="text-xs text-ink-muted">
                  {item.quantity} × {formatCents(item.price)}
                </span>
                {item.stockShortfall && <span className="text-xs text-danger">Stock short</span>}
              </div>
              <span className="text-sm text-ink">{formatCents(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">Payment</h2>
        <Row label="Subtotal" value={formatCents(order.subtotal)} />
        <Row label="Platform fee" value={`− ${formatCents(order.platformFee)}`} />
        <Row label="You receive" value={formatCents(order.sellerAmount)} strong />
        <p className="mt-1 text-xs text-ink-muted">{TRANSFER_LABELS[order.transferStatus]}</p>
      </section>

      <section className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">Timeline</h2>
        {steps.map((step) => (
          <Row
            key={step.label}
            label={step.label}
            value={step.at ? formatDate(step.at) : 'Not yet'}
          />
        ))}
      </section>
    </div>
  );
}
