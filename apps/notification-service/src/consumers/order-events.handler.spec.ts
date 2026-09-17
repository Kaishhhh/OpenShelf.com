import { Prisma } from '@prisma/client';
import { PermanentError, type IncomingMessage } from '@openshelf/kafka';
import { buildEvent, TOPICS } from '@openshelf/types';

const ORDER = '6aab8f5b64242b36fb8e6029';
const SHOP = '6aaaa9a30f5d2f3b7d3346e7';
const USER = '6a799c56c5d2c32dd3ffcf6c';
const SELLER = '6aa815f1029187b933a0708d';

interface Row {
  recipientRole: string;
  recipientId: string;
  eventId: string;
  type: string;
  title: string;
  body: string;
  orderId: string;
  readAt?: null;
}

/**
 * Enforces the real unique index — (eventId, recipientRole, recipientId) — by throwing the
 * same P2002 Prisma does, so idempotency is tested against the mechanism, not a mock of it.
 */
let rows: Row[] = [];
let orderRow: { id: string; userId: string; shopId: string; shop: { name: string; sellerId: string } } | null;
let createImpl: ((data: Row) => Promise<void>) | null = null;

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    order: {
      findUnique: () => Promise.resolve(orderRow),
    },
    notification: {
      create: async ({ data }: { data: Row }) => {
        if (createImpl) return createImpl(data);
        const clash = rows.some(
          (r) =>
            r.eventId === data.eventId &&
            r.recipientRole === data.recipientRole &&
            r.recipientId === data.recipientId
        );
        if (clash) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        rows.push(data);
        return data;
      },
    },
  },
}));

import {
  handleOrderEvent,
  parseOrderEvent,
  setNotificationDelivery,
} from './order-events.handler.js';

const created = () =>
  buildEvent(TOPICS.ORDER_CREATED, {
    orderId: ORDER,
    shopId: SHOP,
    userId: USER,
    status: 'PAID',
    subtotal: 2500,
    currency: 'usd',
  });

const statusChanged = (status: 'SHIPPED' | 'DELIVERED' | 'CANCELLED') =>
  buildEvent(TOPICS.ORDER_STATUS_CHANGED, {
    orderId: ORDER,
    shopId: SHOP,
    userId: USER,
    status,
  });

const asMessage = (value: unknown, attempt = 0): IncomingMessage => ({
  topic: 'order.created',
  key: ORDER,
  value:
    value === null
      ? null
      : Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  headers: {},
  attempt,
});

afterEach(() => setNotificationDelivery(undefined));

beforeEach(() => {
  rows = [];
  createImpl = null;
  orderRow = {
    id: ORDER,
    userId: USER,
    shopId: SHOP,
    shop: { name: 'Purchasability Test Shop', sellerId: SELLER },
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('order.created', () => {
  it('notifies the buyer and the seller, using names re-read from the database', async () => {
    const event = created();
    await handleOrderEvent(asMessage(event));

    expect(rows).toEqual([
      {
        recipientRole: 'USER',
        recipientId: USER,
        eventId: event.eventId,
        type: 'order.created',
        orderId: ORDER,
        title: 'Order confirmed',
        body: 'Your order from Purchasability Test Shop ($25.00) is confirmed.',
        readAt: null,
      },
      {
        recipientRole: 'SELLER',
        recipientId: SELLER,
        eventId: event.eventId,
        type: 'order.created',
        orderId: ORDER,
        title: 'New order',
        body: 'You have a new order for $25.00.',
        readAt: null,
      },
    ]);
  });

  // At-least-once delivery: the same bytes arrive twice.
  it('writes nothing the second time the same event is delivered', async () => {
    const message = asMessage(created());
    await handleOrderEvent(message);
    await handleOrderEvent(message);
    await handleOrderEvent({ ...message, attempt: 2 });

    expect(rows).toHaveLength(2);
    expect(console.log).toHaveBeenLastCalledWith(
      expect.stringContaining('buyer=duplicate seller=duplicate')
    );
  });

  // A redelivery that crashed between the two inserts must complete, not duplicate.
  it('completes a half-written event on redelivery', async () => {
    const event = created();
    rows.push({
      recipientRole: 'USER',
      recipientId: USER,
      eventId: event.eventId,
      type: 'order.created',
      title: 'Order confirmed',
      body: '…',
      orderId: ORDER,
    });
    await handleOrderEvent(asMessage(event));
    expect(rows.map((r) => r.recipientRole)).toEqual(['USER', 'SELLER']);
  });

  it('treats a different event for the same order as new', async () => {
    await handleOrderEvent(asMessage(created()));
    await handleOrderEvent(asMessage(created()));
    expect(rows).toHaveLength(4);
  });
});

describe('stored shape', () => {
  it('writes readAt as an explicit null, so unread filters match it on MongoDB', async () => {
    const written: Record<string, unknown>[] = [];
    createImpl = async (data) => {
      written.push(data as unknown as Record<string, unknown>);
    };
    await handleOrderEvent(asMessage(created()));
    expect(written).toHaveLength(2);
    for (const data of written) {
      expect(data).toHaveProperty('readAt', null);
    }
  });
});

describe('order.status-changed', () => {
  it('notifies only the buyer', async () => {
    await handleOrderEvent(asMessage(statusChanged('SHIPPED')));
    expect(rows).toEqual([
      expect.objectContaining({
        recipientRole: 'USER',
        recipientId: USER,
        type: 'order.status-changed',
        title: 'Order shipped',
        body: 'Your order from Purchasability Test Shop was shipped.',
      }),
    ]);
  });

  it('is idempotent too', async () => {
    const message = asMessage(statusChanged('CANCELLED'));
    await handleOrderEvent(message);
    await handleOrderEvent(message);
    expect(rows).toHaveLength(1);
  });
});

describe('poison messages are permanent failures', () => {
  it.each([
    ['a tombstone', null],
    ['non-JSON bytes', Buffer.from([0xde, 0xad, 0xbe, 0xef])],
    ['truncated JSON', '{"eventId":"'],
    ['JSON that is not an event', { hello: 'world' }],
    ['an unknown event type', { ...created(), type: 'order.refunded' }],
    ['a non-uuid eventId', { ...created(), eventId: 'abc' }],
    ['a float subtotal', { ...created(), payload: { ...created().payload, subtotal: 25.5 } }],
  ])('%s', async (_label, value) => {
    await expect(handleOrderEvent(asMessage(value))).rejects.toBeInstanceOf(PermanentError);
    expect(rows).toHaveLength(0);
  });

  it('names the failing field', () => {
    expect(() =>
      parseOrderEvent(asMessage({ ...created(), occurredAt: 'yesterday' }))
    ).toThrow(/occurredAt/);
  });

  it('an order that does not exist', async () => {
    orderRow = null;
    await expect(handleOrderEvent(asMessage(created()))).rejects.toBeInstanceOf(PermanentError);
  });

  it('an event whose buyer disagrees with the database', async () => {
    orderRow = { ...(orderRow as NonNullable<typeof orderRow>), userId: 'ffffffffffffffffffffffff' };
    await expect(handleOrderEvent(asMessage(created()))).rejects.toBeInstanceOf(PermanentError);
    expect(rows).toHaveLength(0);
  });
});

describe('transient failures', () => {
  // Not PermanentError, so the runtime retries it rather than dead-lettering it.
  it('lets a database error through unclassified', async () => {
    createImpl = () => Promise.reject(new Error('Server selection timeout'));
    const failure = handleOrderEvent(asMessage(created()));
    await expect(failure).rejects.toThrow('Server selection timeout');
    await expect(failure).rejects.not.toBeInstanceOf(PermanentError);
  });
});

describe('delivery', () => {
  it('delivers each newly written row, after it is written', async () => {
    const delivered: { role: string; rowsAtDelivery: number }[] = [];
    setNotificationDelivery(async (row) => {
      delivered.push({ role: row.recipientRole, rowsAtDelivery: rows.length });
    });

    await handleOrderEvent(asMessage(created()));

    // The buyer row exists when the buyer is delivered to; the seller row likewise.
    expect(delivered).toEqual([
      { role: 'USER', rowsAtDelivery: 1 },
      { role: 'SELLER', rowsAtDelivery: 2 },
    ]);
  });

  // A redelivered event must not show the notification a second time.
  it('delivers nothing for a duplicate', async () => {
    const message = asMessage(created());
    await handleOrderEvent(message);

    const deliver = jest.fn().mockResolvedValue(undefined);
    setNotificationDelivery(deliver);
    await handleOrderEvent(message);

    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers only the half a crashed delivery never wrote', async () => {
    const event = created();
    rows.push({
      recipientRole: 'USER',
      recipientId: USER,
      eventId: event.eventId,
      type: 'order.created',
      title: 'Order confirmed',
      body: '…',
      orderId: ORDER,
    });
    const deliver = jest.fn().mockResolvedValue(undefined);
    setNotificationDelivery(deliver);

    await handleOrderEvent(asMessage(event));

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toMatchObject({ recipientRole: 'SELLER' });
  });

  // The row is written; a delivery failure must not send the event to the retry topic.
  it('does not fail the handler when delivery throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    setNotificationDelivery(() => Promise.reject(new Error('socket adapter down')));
    await expect(handleOrderEvent(asMessage(created()))).resolves.toBeUndefined();
    expect(rows).toHaveLength(2);
  });
});
