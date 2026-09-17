import type { PushResult } from '@openshelf/firebase';
import type { Realtime } from '../realtime/socket.js';
import { createDeliverer, type DeliverableNotification, type DeliveryDeps } from './deliver.js';

const row: DeliverableNotification = {
  id: 'n1',
  recipientRole: 'SELLER',
  recipientId: 'seller-1',
  type: 'order.created',
  title: 'New order',
  body: 'You have a new order for $24.00.',
  orderId: 'order-1',
  readAt: null,
  createdAt: new Date('2026-09-17T10:00:00Z'),
};

let steps: string[];
let connected: boolean;

function deps(over: Partial<DeliveryDeps> = {}): DeliveryDeps & {
  pushes: unknown[][];
  removed: unknown[][];
  emits: unknown[][];
} {
  const pushes: unknown[][] = [];
  const removed: unknown[][] = [];
  const emits: unknown[][] = [];
  const realtime = {
    emitToRecipient: (...args: unknown[]) => {
      steps.push('emit');
      emits.push(args);
    },
    hasConnectedSockets: async () => {
      steps.push('presence');
      return connected;
    },
  } as unknown as Realtime;

  return {
    realtime: () => realtime,
    sendPush: async (tokens, message): Promise<PushResult> => {
      steps.push('push');
      pushes.push([tokens, message]);
      return { successCount: tokens.length, failureCount: 0, invalidTokens: [] };
    },
    loadTokens: async () => ['token-a', 'token-b'],
    removeTokens: async (...args) => {
      removed.push(args);
    },
    uiUrl: (role) => (role === 'SELLER' ? 'http://localhost:3001' : 'http://localhost:3000'),
    ...over,
    pushes,
    removed,
    emits,
  };
}

beforeEach(() => {
  steps = [];
  connected = false;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('emits to the recipient room with the public projection, before checking presence', async () => {
  const d = deps();
  await createDeliverer(d)(row);

  expect(steps.slice(0, 2)).toEqual(['emit', 'presence']);
  expect(d.emits[0]).toEqual([
    'SELLER',
    'seller-1',
    'notification:new',
    {
      id: 'n1',
      type: 'order.created',
      title: 'New order',
      body: 'You have a new order for $24.00.',
      orderId: 'order-1',
      readAt: null,
      createdAt: row.createdAt,
    },
  ]);
});

// A duplicate is worse than none.
it('does not push to a recipient with a connected socket', async () => {
  connected = true;
  const d = deps();
  await expect(createDeliverer(d)(row)).resolves.toBe('emitted');
  expect(d.pushes).toHaveLength(0);
});

it('pushes to an offline recipient, linking to the order in their own UI', async () => {
  const d = deps();
  await expect(createDeliverer(d)(row)).resolves.toBe('pushed');
  expect(d.pushes).toEqual([
    [
      ['token-a', 'token-b'],
      {
        title: 'New order',
        body: 'You have a new order for $24.00.',
        link: 'http://localhost:3001/orders/order-1',
        data: { notificationId: 'n1', orderId: 'order-1' },
      },
    ],
  ]);
});

it('links a buyer to user-ui', async () => {
  const d = deps();
  await createDeliverer(d)({ ...row, recipientRole: 'USER', recipientId: 'user-1' });
  expect((d.pushes[0][1] as { link: string }).link).toBe('http://localhost:3000/orders/order-1');
});

it('removes the tokens FCM reports dead', async () => {
  const d = deps({
    sendPush: async () => ({ successCount: 1, failureCount: 1, invalidTokens: ['token-b'] }),
  });
  await createDeliverer(d)(row);
  expect(d.removed).toEqual([['SELLER', 'seller-1', ['token-b']]]);
});

it('reports no channel for an offline recipient without tokens, and makes no FCM call', async () => {
  const d = deps({ loadTokens: async () => [] });
  await expect(createDeliverer(d)(row)).resolves.toBe('no-channel');
  expect(d.pushes).toHaveLength(0);
});

describe('never throws', () => {
  it('when the push fails', async () => {
    const d = deps({ sendPush: () => Promise.reject(new Error('FCM unavailable')) });
    await expect(createDeliverer(d)(row)).resolves.toBe('failed');
    expect(console.error).toHaveBeenCalled();
  });

  it('when the emit throws — and still pushes to an offline recipient', async () => {
    const d = deps();
    const realtime = d.realtime() as Realtime;
    realtime.emitToRecipient = () => {
      throw new Error('adapter publish failed');
    };
    await expect(createDeliverer(d)(row)).resolves.toBe('pushed');
  });

  // Unknown presence: a miss is recoverable from the feed, a duplicate is not.
  it('when presence cannot be determined — and does not push', async () => {
    const d = deps();
    (d.realtime() as Realtime).hasConnectedSockets = () =>
      Promise.reject(new Error('fetchSockets timeout'));
    await expect(createDeliverer(d)(row)).resolves.toBe('failed');
    expect(d.pushes).toHaveLength(0);
  });

  it('when token cleanup fails', async () => {
    const d = deps({
      sendPush: async () => ({ successCount: 0, failureCount: 1, invalidTokens: ['token-a'] }),
      removeTokens: () => Promise.reject(new Error('db down')),
    });
    await expect(createDeliverer(d)(row)).resolves.toBe('failed');
  });
});

it('pushes when no realtime server is attached', async () => {
  const d = deps({ realtime: () => undefined });
  await expect(createDeliverer(d)(row)).resolves.toBe('pushed');
});
