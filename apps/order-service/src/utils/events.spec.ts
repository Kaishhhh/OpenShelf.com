const publish = jest.fn();

jest.mock('@openshelf/kafka', () => {
  const actual = jest.requireActual('@openshelf/kafka');
  return {
    ...actual,
    // Deferred: events.ts builds its producer at import, before `publish` above is
    // initialised (jest.mock is hoisted).
    createProducer: () => ({
      publish: (...args: unknown[]) => publish(...args),
      disconnect: jest.fn(),
    }),
  };
});

import { emitOrderCreated, emitOrderStatusChanged } from './events.js';

const ids = {
  orderId: '6aab8f5b64242b36fb8e6029',
  shopId: '6aaaa9a30f5d2f3b7d3346e7',
  userId: '6a799c56c5d2c32dd3ffcf6c',
};

const payload = {
  ...ids,
  status: 'PAID' as const,
  subtotal: 2500,
  currency: 'usd',
};

beforeEach(() => {
  publish.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('emitOrderCreated', () => {
  it('publishes a valid envelope to order.created, keyed by the order', async () => {
    publish.mockResolvedValue(undefined);
    await emitOrderCreated(payload);

    expect(publish).toHaveBeenCalledWith(
      'order.created',
      expect.objectContaining({
        type: 'order.created',
        eventId: expect.any(String),
        occurredAt: expect.any(String),
        payload,
      }),
      payload.orderId
    );
  });

  // The buyer has paid; nothing about Kafka may reach the webhook handler.
  it('resolves when the broker is down', async () => {
    publish.mockRejectedValue(new Error('Connection error: connect ECONNREFUSED'));
    await expect(emitOrderCreated(payload)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('resolves, without publishing, when the payload breaks the contract', async () => {
    await expect(
      emitOrderCreated({ ...payload, subtotal: 12.5 })
    ).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('FAILED to build order.created'),
      expect.anything()
    );
  });
});

describe('emitOrderStatusChanged', () => {
  it('publishes to order.status-changed', async () => {
    publish.mockResolvedValue(undefined);
    await emitOrderStatusChanged({ ...ids, status: 'SHIPPED' });
    expect(publish).toHaveBeenCalledWith(
      'order.status-changed',
      expect.objectContaining({ type: 'order.status-changed', payload: { ...ids, status: 'SHIPPED' } }),
      payload.orderId
    );
  });

  it('resolves when publishing throws', async () => {
    publish.mockImplementation(() => Promise.reject(new Error('timeout')));
    await expect(emitOrderStatusChanged({ ...ids, status: 'SHIPPED' })).resolves.toBeUndefined();
  });
});
