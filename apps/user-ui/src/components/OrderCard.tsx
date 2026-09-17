import type { BuyerOrder } from '@openshelf/types';
import { formatCents } from './Price';

const STATUS_LABELS: Record<BuyerOrder['status'], string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/** One shop's order. Every amount on it is integer cents. */
export function OrderCard({ order }: { order: BuyerOrder }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <a
          href={`/shops/${order.shop.id}`}
          className="text-sm font-medium text-ink hover:text-accent"
        >
          {order.shop.name}
        </a>
        <span className="rounded-card border border-line px-1.5 py-0.5 text-xs text-ink-muted">
          {STATUS_LABELS[order.status]}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-2 text-sm">
            <span className="truncate text-ink">
              {item.quantity} × {item.title}
            </span>
            <span className="shrink-0 text-ink-muted">{formatCents(item.lineTotal)}</span>
          </li>
        ))}
      </ul>

      {/* The buyer has paid for something the seller may not have. Resolving it belongs
          to the fulfilment and refund slices; this only keeps it from being a surprise. */}
      {order.stockShortfall && (
        <p className="text-xs text-ink-muted">
          One or more items may be delayed — the shop is checking stock.
        </p>
      )}

      <div className="flex justify-between border-t border-line pt-2 text-sm">
        <span className="text-ink-muted">Subtotal</span>
        <span className="text-ink">{formatCents(order.subtotal)}</span>
      </div>
    </section>
  );
}
