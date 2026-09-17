import {
  TOPICS,
  buildEvent,
  orderCreatedEventSchema,
  orderEventSchema,
} from './events.js';

const ORDER = '6aab8f5b64242b36fb8e6029';
const SHOP = '6aaaa9a30f5d2f3b7d3346e7';
const USER = '6a799c56c5d2c32dd3ffcf6c';

const createdPayload = {
  orderId: ORDER,
  shopId: SHOP,
  userId: USER,
  status: 'PAID' as const,
  subtotal: 2500,
  currency: 'usd',
};

describe('buildEvent', () => {
  it('stamps a uuid eventId, the type and an ISO occurredAt around the payload', () => {
    const event = buildEvent(TOPICS.ORDER_CREATED, createdPayload);
    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(event.type).toBe('order.created');
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
    expect(event.payload).toEqual(createdPayload);
  });

  it('gives every event its own id', () => {
    const a = buildEvent(TOPICS.ORDER_CREATED, createdPayload);
    const b = buildEvent(TOPICS.ORDER_CREATED, createdPayload);
    expect(a.eventId).not.toBe(b.eventId);
  });

  // The producer fails where the bug is, instead of every consumer receiving poison.
  it('throws on a payload the consumer schema would reject', () => {
    expect(() =>
      buildEvent(TOPICS.ORDER_CREATED, { ...createdPayload, subtotal: 12.5 })
    ).toThrow();
    expect(() =>
      buildEvent(TOPICS.ORDER_STATUS_CHANGED, {
        orderId: 'not-an-id',
        shopId: SHOP,
        userId: USER,
        status: 'SHIPPED',
      })
    ).toThrow();
  });
});

describe('orderEventSchema', () => {
  it('parses both event types by their discriminator', () => {
    const created = buildEvent(TOPICS.ORDER_CREATED, createdPayload);
    const changed = buildEvent(TOPICS.ORDER_STATUS_CHANGED, {
      orderId: ORDER,
      shopId: SHOP,
      userId: USER,
      status: 'SHIPPED',
    });
    expect(orderEventSchema.parse(JSON.parse(JSON.stringify(created)))).toEqual(created);
    expect(orderEventSchema.parse(JSON.parse(JSON.stringify(changed)))).toEqual(changed);
  });

  it.each([
    ['an unknown type', (e: Record<string, unknown>) => ({ ...e, type: 'order.refunded' })],
    [
      'a missing eventId',
      (e: Record<string, unknown>) => {
        const copy = { ...e };
        delete copy.eventId;
        return copy;
      },
    ],
    ['a non-uuid eventId', (e: Record<string, unknown>) => ({ ...e, eventId: '123' })],
    ['a bad occurredAt', (e: Record<string, unknown>) => ({ ...e, occurredAt: 'yesterday' })],
    ['a status outside the machine', (e: Record<string, unknown>) => ({
      ...e,
      payload: { ...(e.payload as object), status: 'REFUNDED' },
    })],
  ])('rejects %s', (_label, mutate) => {
    const event = JSON.parse(JSON.stringify(buildEvent(TOPICS.ORDER_CREATED, createdPayload)));
    expect(orderEventSchema.safeParse(mutate(event)).success).toBe(false);
  });

  // Identifiers only: a full record smuggled into the payload is not part of the contract.
  it('strips fields that are not in the contract', () => {
    const event = buildEvent(TOPICS.ORDER_CREATED, createdPayload);
    const parsed = orderCreatedEventSchema.parse({
      ...event,
      payload: { ...event.payload, items: [{ title: 'Mug' }] },
    });
    expect(parsed.payload).not.toHaveProperty('items');
  });
});
