import type { Producer } from 'kafkajs';
import { buildEvent, TOPICS } from '@openshelf/types';
import { createProducer, emitEvent, EVENT_TYPE_HEADER, type EventProducer } from './producer.js';

const event = buildEvent(TOPICS.ORDER_CREATED, {
  orderId: '6aab8f5b64242b36fb8e6029',
  shopId: '6aaaa9a30f5d2f3b7d3346e7',
  userId: '6a799c56c5d2c32dd3ffcf6c',
  status: 'PAID',
  subtotal: 2500,
  currency: 'usd',
});

function fakeProducer(over: Partial<Record<'connect' | 'send' | 'disconnect', jest.Mock>> = {}) {
  return {
    connect: over.connect ?? jest.fn().mockResolvedValue(undefined),
    send: over.send ?? jest.fn().mockResolvedValue([]),
    disconnect: over.disconnect ?? jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('createProducer', () => {
  it('connects once for concurrent publishes and sends JSON keyed by the order', async () => {
    const fake = fakeProducer();
    const producer = createProducer(() => fake as unknown as Producer);

    await Promise.all([
      producer.publish(TOPICS.ORDER_CREATED, event, 'order-1'),
      producer.publish(TOPICS.ORDER_CREATED, event, 'order-1'),
    ]);

    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledWith({
      topic: 'order.created',
      acks: -1,
      messages: [
        {
          key: 'order-1',
          value: JSON.stringify(event),
          headers: { [EVENT_TYPE_HEADER]: 'order.created' },
        },
      ],
    });
  });

  // A broker that was down at the first send must not leave the producer broken forever.
  it('retries the connection on the next publish after a failed connect', async () => {
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(undefined);
    const fake = fakeProducer({ connect });
    const producer = createProducer(() => fake as unknown as Producer);

    await expect(producer.publish(TOPICS.ORDER_CREATED, event, 'k')).rejects.toThrow(
      'ECONNREFUSED'
    );
    await expect(producer.publish(TOPICS.ORDER_CREATED, event, 'k')).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('emitEvent', () => {
  it('never rejects when the send fails, and logs loudly', async () => {
    const producer: EventProducer = {
      publish: jest.fn().mockRejectedValue(new Error('broker down')),
      disconnect: jest.fn(),
    };

    await expect(
      emitEvent(producer, TOPICS.ORDER_CREATED, event, 'order-1')
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`FAILED to produce order.created ${event.eventId}`),
      'Error: broker down'
    );
  });

  it('never throws synchronously either', () => {
    const producer: EventProducer = {
      publish: () => Promise.reject(new Error('boom')),
      disconnect: jest.fn(),
    };
    expect(() => emitEvent(producer, TOPICS.ORDER_CREATED, event, 'k')).not.toThrow();
  });

  it('logs the produced event on success', async () => {
    const producer: EventProducer = {
      publish: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    await emitEvent(producer, TOPICS.ORDER_CREATED, event, 'order-1');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(`produced order.created ${event.eventId}`)
    );
  });
});
