import type { OrderStatus } from '@openshelf/types';

/** Order amounts are integer cents; product prices elsewhere in this app are dollars. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Awaiting shipment',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/** The verb on the button that moves an order *to* a status. */
export const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  SHIPPED: 'Mark as shipped',
  DELIVERED: 'Mark as delivered',
  CANCELLED: 'Cancel order',
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const TRANSFER_LABELS = {
  PENDING: 'Payout pending',
  SUCCEEDED: 'Paid out to your Stripe balance',
  FAILED: 'Payout failed — contact support',
} as const;
