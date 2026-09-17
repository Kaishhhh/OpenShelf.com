import { createProducer, emitEvent } from '@openshelf/kafka';
import {
  buildEvent,
  TOPICS,
  type OrderCreatedEvent,
  type OrderStatusChangedEvent,
} from '@openshelf/types';

/**
 * order-service's one producer. It connects on first use, so the service boots — and
 * checkout works — with no broker reachable at all.
 */
export const producer = createProducer();

/**
 * Every emit below is fire-and-forget and can never throw into a request handler: not on a
 * broker failure (emitEvent logs it), and not on a payload that fails its own contract
 * (logged here). By the time these run the order is committed and the buyer has paid.
 *
 * Each returns a promise that always resolves — handlers do not await it; tests do.
 */
function safely(describe: string, build: () => Promise<void>): Promise<void> {
  try {
    return build();
  } catch (err) {
    console.error(`[kafka] FAILED to build ${describe} — event not produced:`, err);
    return Promise.resolve();
  }
}

export function emitOrderCreated(payload: OrderCreatedEvent['payload']): Promise<void> {
  return safely(`order.created for order ${payload.orderId}`, () =>
    emitEvent(
      producer,
      TOPICS.ORDER_CREATED,
      buildEvent(TOPICS.ORDER_CREATED, payload),
      payload.orderId
    )
  );
}

export function emitOrderStatusChanged(
  payload: OrderStatusChangedEvent['payload']
): Promise<void> {
  return safely(`order.status-changed for order ${payload.orderId}`, () =>
    emitEvent(
      producer,
      TOPICS.ORDER_STATUS_CHANGED,
      buildEvent(TOPICS.ORDER_STATUS_CHANGED, payload),
      payload.orderId
    )
  );
}
