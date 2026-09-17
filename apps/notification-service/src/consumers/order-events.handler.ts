import { Prisma, type NotificationRecipient } from '@prisma/client';
import { PermanentError, type IncomingMessage } from '@openshelf/kafka';
import { prisma } from '@openshelf/prisma';
import type { DeliverableNotification } from '../delivery/deliver.js';
import {
  orderEventSchema,
  type OrderCreatedEvent,
  type OrderEvent,
  type OrderStatusChangedEvent,
} from '@openshelf/types';

const LOG = '[notifications]';

/**
 * Where a freshly written notification goes next. main.ts sets the real deliverer (socket
 * emit, then push); left unset — in tests, or with delivery disabled — rows are only
 * written.
 */
type Deliver = (row: DeliverableNotification) => Promise<unknown>;
let deliver: Deliver | undefined;

export function setNotificationDelivery(fn: Deliver | undefined): void {
  deliver = fn;
}

function formatCents(cents: number, currency: string): string {
  const symbol = currency.toLowerCase() === 'usd' ? '$' : `${currency.toUpperCase()} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/**
 * Decodes and validates a message, or throws PermanentError — nothing about a malformed
 * message improves with a retry, so it goes straight to the dead-letter topic.
 */
export function parseOrderEvent(message: IncomingMessage): OrderEvent {
  if (message.value === null) {
    throw new PermanentError('Empty message value (tombstone)');
  }

  let json: unknown;
  try {
    json = JSON.parse(message.value.toString('utf8'));
  } catch (err) {
    throw new PermanentError('Message value is not valid JSON', { cause: err });
  }

  const result = orderEventSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new PermanentError(`Event failed its contract — ${issues}`);
  }
  return result.data;
}

interface NotificationInput {
  recipientRole: NotificationRecipient;
  recipientId: string;
  eventId: string;
  type: string;
  title: string;
  body: string;
  orderId: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Writes one notification, or recognises it was already written.
 *
 * Kafka delivers at least once, so the same event will arrive again — after a rebalance,
 * a crash before commit, or a retry that raced its original. The unique index on
 * (eventId, recipientRole, recipientId) makes the second insert fail with P2002, which is
 * the idempotency check itself: no read-then-write window for two deliveries to slip
 * through together.
 */
async function insertOnce(data: NotificationInput): Promise<'created' | 'duplicate'> {
  let row: DeliverableNotification;
  try {
    row = await prisma.notification.create({
      // readAt written as an explicit null. Left out, MongoDB stores no field at all, and
      // Prisma's `readAt: null` filter does not match a missing field.
      data: { ...data, readAt: null },
      select: {
        id: true,
        recipientRole: true,
        recipientId: true,
        type: true,
        title: true,
        body: true,
        orderId: true,
        readAt: true,
        createdAt: true,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return 'duplicate';
    }
    throw err;
  }

  // Only a row this delivery created is delivered. A duplicate was delivered — or at least
  // written — by the delivery that created it; re-emitting would show it twice.
  if (deliver) {
    try {
      await deliver(row);
    } catch (err) {
      // The deliverer never throws by contract; this guards the contract.
      console.error(`${LOG} delivery threw for notification ${row.id} —`, err);
    }
  }
  return 'created';
}

/**
 * The order an event is about, re-read from the database. Events carry identifiers only;
 * names, recipients and the current state come from here.
 *
 * Checkout commits orders before producing order.created, so an order that is not there is
 * not "not yet" — it is gone or never existed, and retrying will not change that.
 */
async function loadOrder(event: OrderEvent) {
  const order = await prisma.order.findUnique({
    where: { id: event.payload.orderId },
    select: {
      id: true,
      userId: true,
      shopId: true,
      shop: { select: { name: true, sellerId: true } },
    },
  });
  if (!order) {
    throw new PermanentError(`Order ${event.payload.orderId} does not exist`);
  }
  // The database is the source of truth. An event that disagrees with it about who the
  // order belongs to is not something to notify anyone about.
  if (order.userId !== event.payload.userId || order.shopId !== event.payload.shopId) {
    throw new PermanentError(
      `Event ${event.eventId} does not match order ${order.id}'s buyer or shop`
    );
  }
  return order;
}

async function onOrderCreated(event: OrderCreatedEvent) {
  const order = await loadOrder(event);
  const amount = formatCents(event.payload.subtotal, event.payload.currency);
  const common = { eventId: event.eventId, type: event.type, orderId: order.id };

  const buyer = await insertOnce({
    ...common,
    recipientRole: 'USER',
    recipientId: order.userId,
    title: 'Order confirmed',
    body: `Your order from ${order.shop.name} (${amount}) is confirmed.`,
  });
  const seller = await insertOnce({
    ...common,
    recipientRole: 'SELLER',
    recipientId: order.shop.sellerId,
    title: 'New order',
    body: `You have a new order for ${amount}.`,
  });

  return { buyer, seller };
}

const STATUS_WORDS: Record<string, string> = {
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

/** The seller made the change, so only the buyer is told. */
async function onOrderStatusChanged(event: OrderStatusChangedEvent) {
  const order = await loadOrder(event);
  const word = STATUS_WORDS[event.payload.status] ?? event.payload.status.toLowerCase();

  const buyer = await insertOnce({
    eventId: event.eventId,
    type: event.type,
    orderId: order.id,
    recipientRole: 'USER',
    recipientId: order.userId,
    title: `Order ${word}`,
    body: `Your order from ${order.shop.name} was ${word}.`,
  });

  return { buyer };
}

/**
 * The handler for both order topics. Throws PermanentError for anything a retry cannot
 * fix; any other error (a database outage, a timeout) propagates and is retried by the
 * consumer runtime.
 */
export async function handleOrderEvent(message: IncomingMessage): Promise<void> {
  const event = parseOrderEvent(message);

  const outcome =
    event.type === 'order.created'
      ? await onOrderCreated(event)
      : await onOrderStatusChanged(event);

  const summary = Object.entries(outcome)
    .map(([recipient, result]) => `${recipient}=${result}`)
    .join(' ');
  console.log(
    `${LOG} consumed ${event.type} ${event.eventId} order=${event.payload.orderId} attempt=${message.attempt} ${summary}`
  );
}
