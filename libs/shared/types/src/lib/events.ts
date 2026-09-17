import { z } from 'zod';
import { ORDER_STATUSES } from './order-status';

/**
 * Event contracts for the Kafka backbone.
 *
 * Producers build events with buildEvent, which parses its own output against the same
 * schema consumers parse with — so a producer cannot emit what a consumer would reject,
 * and the two cannot drift.
 *
 * **Events are notifications, not data transfer.** Payloads carry identifiers and the few
 * values that describe what happened; a consumer that needs anything else re-reads it
 * from the database. That keeps events small, and it means a consumer acting on an old
 * event reads current state rather than a stale copy.
 */

export const TOPICS = {
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status-changed',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid ObjectId');

/** The fields every event carries, around a typed payload. */
function envelope<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) {
  return z.object({
    eventId: z.uuid(),
    type: z.literal(type),
    occurredAt: z.iso.datetime(),
    payload,
  });
}

/** One per shop order, produced once payment is confirmed and the orders are committed. */
export const orderCreatedEventSchema = envelope(
  TOPICS.ORDER_CREATED,
  z.object({
    orderId: objectId,
    shopId: objectId,
    userId: objectId,
    status: z.enum(ORDER_STATUSES),
    /** This shop's subtotal, in cents. */
    subtotal: z.number().int().nonnegative(),
    currency: z.string().min(3).max(3),
  })
);

/** Produced on every successful seller status transition. `status` is the new status. */
export const orderStatusChangedEventSchema = envelope(
  TOPICS.ORDER_STATUS_CHANGED,
  z.object({
    orderId: objectId,
    shopId: objectId,
    userId: objectId,
    status: z.enum(ORDER_STATUSES),
  })
);

export const orderEventSchema = z.discriminatedUnion('type', [
  orderCreatedEventSchema,
  orderStatusChangedEventSchema,
]);

export type OrderCreatedEvent = z.infer<typeof orderCreatedEventSchema>;
export type OrderStatusChangedEvent = z.infer<typeof orderStatusChangedEventSchema>;
export type OrderEvent = z.infer<typeof orderEventSchema>;

type EventOf<T extends OrderEvent['type']> = Extract<OrderEvent, { type: T }>;

/**
 * Stamps a fresh eventId and occurredAt onto a payload and validates the result.
 *
 * Throws on an invalid payload — at the producer, where the bug is, rather than as a
 * poison message at every consumer.
 */
export function buildEvent<T extends OrderEvent['type']>(
  type: T,
  payload: EventOf<T>['payload']
): EventOf<T> {
  return orderEventSchema.parse({
    eventId: globalThis.crypto.randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    payload,
  }) as EventOf<T>;
}
