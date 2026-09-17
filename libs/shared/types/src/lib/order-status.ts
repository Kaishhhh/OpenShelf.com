/**
 * The order lifecycle, as a state machine rather than a free field.
 *
 * Shared by order-service, which enforces it, and seller-ui, which renders only the
 * transitions this table allows — so a button for an illegal move can never exist.
 *
 * PENDING has no outgoing transitions for a seller: checkout only ever writes orders as
 * PAID, and PENDING is reserved for flows that do not exist yet.
 *
 * DELIVERED and CANCELLED are terminal. Cancelling does not refund — see
 * updateOrderStatus in order-service for what a refunds slice must do.
 */

export const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: [],
  PAID: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Every status an order may be in for a move to `to` to be legal. The server puts this in
 * the update's `where`, which is what makes the transition a single atomic compare-and-set.
 */
export function legalSourcesFor(to: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter((from) => canTransition(from, to));
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}
