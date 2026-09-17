import type { Request, Response } from 'express';
import { AuthError, NotFoundError, ValidationError } from '@openshelf/errors';

const BUYER = '6a799c56c5d2c32dd3ffcf6c';
const OTHER_BUYER = '6a799c56c5d2c32dd3ffcf6d';
const SELLER = '6aa815f1029187b933a0708d';
const N_BUYER = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const N_BUYER_READ = 'aaaaaaaaaaaaaaaaaaaaaaa2';
const N_OTHER = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const N_SELLER = 'ccccccccccccccccccccccc1';
const TOKEN = 'fcm-token-'.padEnd(40, 'x');

interface Row {
  id: string;
  recipientRole: 'USER' | 'SELLER';
  recipientId: string;
  eventId: string;
  type: string;
  title: string;
  body: string;
  orderId: string | null;
  /** Absent (undefined) models a MongoDB document with no readAt field at all. */
  readAt?: Date | null;
  createdAt: Date;
}

const row = (over: Partial<Row>): Row => ({
  id: N_BUYER,
  recipientRole: 'USER',
  recipientId: BUYER,
  eventId: '00000000-0000-4000-8000-000000000001',
  type: 'order.created',
  title: 'Order confirmed',
  body: 'Your order is confirmed.',
  orderId: '6aab8f5b64242b36fb8e6029',
  readAt: null,
  createdAt: new Date('2026-09-17T10:00:00Z'),
  ...over,
});

let table: Row[] = [];
const wheres: Record<string, unknown>[] = [];
const emits: { role: string; id: string; event: string; payload: unknown }[] = [];
const tokenCalls: unknown[][] = [];

type ReadAtFilter = null | { isSet: false };
interface Where {
  id?: string;
  recipientRole: string;
  recipientId: string;
  readAt?: ReadAtFilter;
  OR?: { readAt: ReadAtFilter }[];
}

/**
 * Prisma-on-MongoDB semantics, which the first version of this fake got wrong: `readAt:
 * null` matches only a stored null, and `isSet: false` only a missing field.
 */
function readAtMatches(r: Row, filter: ReadAtFilter): boolean {
  return filter === null ? 'readAt' in r && r.readAt === null : !('readAt' in r);
}

const matches = (r: Row, w: Where) =>
  r.recipientRole === w.recipientRole &&
  r.recipientId === w.recipientId &&
  (w.id === undefined || r.id === w.id) &&
  (!('readAt' in w) || readAtMatches(r, w.readAt as ReadAtFilter)) &&
  (w.OR === undefined || w.OR.some((clause) => readAtMatches(r, clause.readAt)));

const pick = (r: Row, select: Record<string, true>) =>
  Object.fromEntries(Object.keys(select).map((k) => [k, r[k as keyof Row] ?? null]));

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    notification: {
      findMany: ({ where, select }: { where: Where; select: Record<string, true> }) => {
        wheres.push(where as unknown as Record<string, unknown>);
        return Promise.resolve(table.filter((r) => matches(r, where)).map((r) => pick(r, select)));
      },
      findFirst: ({ where, select }: { where: Where; select: Record<string, true> }) => {
        const found = table.find((r) => matches(r, where));
        return Promise.resolve(found ? pick(found, select) : null);
      },
      count: ({ where }: { where: Where }) =>
        Promise.resolve(table.filter((r) => matches(r, where)).length),
      updateMany: ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hits = table.filter((r) => matches(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hits.length });
      },
    },
  },
}));

jest.mock('../realtime/socket.js', () => ({
  getRealtime: () => ({
    emitToRecipient: (role: string, id: string, event: string, payload: unknown) =>
      emits.push({ role, id, event, payload }),
  }),
}));

jest.mock('../delivery/fcm-tokens.js', () => ({
  registerToken: (...args: unknown[]) => {
    tokenCalls.push(['register', ...args]);
    return Promise.resolve();
  },
  removeTokens: (...args: unknown[]) => {
    tokenCalls.push(['remove', ...args]);
    return Promise.resolve();
  },
}));

import {
  listSellerNotifications,
  listUserNotifications,
  markAllUserNotificationsRead,
  markSellerNotificationRead,
  markUserNotificationRead,
  registerSellerToken,
  registerUserToken,
  removeUserToken,
} from './notification.controller.js';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown as Record<string, unknown>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: Record<string, unknown>) {
      res.body = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

type Over = { params?: object; query?: object; body?: unknown };
const asBuyer = (id: string, over: Over = {}) =>
  ({ user: { id }, params: {}, query: {}, body: {}, ...over }) as unknown as Request;
const asSeller = (id: string, over: Over = {}) =>
  ({ seller: { id }, params: {}, query: {}, body: {}, ...over }) as unknown as Request;
const r = (res: ReturnType<typeof mockRes>) => res as unknown as Response;

beforeEach(() => {
  wheres.length = 0;
  emits.length = 0;
  tokenCalls.length = 0;
  table = [
    row({}),
    row({ id: N_BUYER_READ, readAt: new Date('2026-09-17T11:00:00Z') }),
    row({ id: N_OTHER, recipientId: OTHER_BUYER }),
    row({ id: N_SELLER, recipientRole: 'SELLER', recipientId: SELLER, title: 'New order' }),
  ];
});

describe('listing', () => {
  it("returns the caller's own notifications with their unread count, and no internal fields", async () => {
    const res = mockRes();
    await listUserNotifications(asBuyer(BUYER, { query: { recipientId: OTHER_BUYER } }), r(res));

    const notifications = res.body.notifications as Record<string, unknown>[];
    expect(notifications.map((n) => n.id).sort()).toEqual([N_BUYER, N_BUYER_READ].sort());
    expect(res.body).toMatchObject({ unreadCount: 1, total: 2, page: 1, limit: 20 });
    expect(notifications[0]).not.toHaveProperty('eventId');
    expect(notifications[0]).not.toHaveProperty('recipientId');
    expect(wheres[0]).toEqual({ recipientRole: 'USER', recipientId: BUYER });
  });

  it('never returns seller notifications in the buyer feed, even for the same id', async () => {
    const res = mockRes();
    await listUserNotifications(asBuyer(SELLER), r(res));
    expect(res.body.notifications).toEqual([]);
  });

  it("gives a seller only theirs", async () => {
    const res = mockRes();
    await listSellerNotifications(asSeller(SELLER), r(res));
    expect((res.body.notifications as { id: string }[]).map((n) => n.id)).toEqual([N_SELLER]);
    expect(res.body.unreadCount).toBe(1);
  });

  it('401s without a caller and 400s a bad page', async () => {
    await expect(
      listUserNotifications({ query: {} } as unknown as Request, r(mockRes()))
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      listUserNotifications(asBuyer(BUYER, { query: { page: '0' } }), r(mockRes()))
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('mark as read', () => {
  it('sets readAt, returns the notification and tells the other tabs', async () => {
    const res = mockRes();
    await markUserNotificationRead(asBuyer(BUYER, { params: { id: N_BUYER } }), r(res));

    expect(res.body.readAt).toBeInstanceOf(Date);
    expect(table.find((n) => n.id === N_BUYER)?.readAt).toBeInstanceOf(Date);
    expect(emits).toEqual([
      { role: 'USER', id: BUYER, event: 'notification:read', payload: { ids: [N_BUYER] } },
    ]);
  });

  it('is idempotent: an already-read notification keeps its readAt and broadcasts nothing', async () => {
    const before = table.find((n) => n.id === N_BUYER_READ)?.readAt;
    const res = mockRes();
    await markUserNotificationRead(asBuyer(BUYER, { params: { id: N_BUYER_READ } }), r(res));
    expect(res.body.readAt).toBe(before);
    expect(emits).toHaveLength(0);
  });

  it("404s another recipient's notification and leaves it unread", async () => {
    await expect(
      markUserNotificationRead(asBuyer(BUYER, { params: { id: N_OTHER } }), r(mockRes()))
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(table.find((n) => n.id === N_OTHER)?.readAt).toBeNull();

    // A buyer's id presented on the seller route is not the seller's notification either.
    await expect(
      markSellerNotificationRead(asSeller(SELLER, { params: { id: N_BUYER } }), r(mockRes()))
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(table.find((n) => n.id === N_BUYER)?.readAt).toBeNull();
  });

  it('404s a malformed id', async () => {
    await expect(
      markUserNotificationRead(asBuyer(BUYER, { params: { id: 'nope' } }), r(mockRes()))
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('marks all of the caller\'s unread, and only theirs', async () => {
    const res = mockRes();
    await markAllUserNotificationsRead(asBuyer(BUYER), r(res));
    expect(res.body).toEqual({ updated: 1 });
    expect(table.find((n) => n.id === N_OTHER)?.readAt).toBeNull();
    expect(table.find((n) => n.id === N_SELLER)?.readAt).toBeNull();
    expect(emits[0]).toMatchObject({ role: 'USER', id: BUYER, payload: { all: true } });
  });
});

describe('push tokens', () => {
  it('registers against the authenticated caller, never an id from the body', async () => {
    const res = mockRes();
    await registerUserToken(asBuyer(BUYER, { body: { token: TOKEN } }), r(res));
    await registerSellerToken(asSeller(SELLER, { body: { token: TOKEN } }), r(mockRes()));

    expect(res.statusCode).toBe(204);
    expect(tokenCalls).toEqual([
      ['register', 'USER', BUYER, TOKEN],
      ['register', 'SELLER', SELLER, TOKEN],
    ]);
  });

  it('rejects extra fields and junk tokens', async () => {
    await expect(
      registerUserToken(asBuyer(BUYER, { body: { token: TOKEN, userId: OTHER_BUYER } }), r(mockRes()))
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      registerUserToken(asBuyer(BUYER, { body: { token: 'x' } }), r(mockRes()))
    ).rejects.toBeInstanceOf(ValidationError);
    expect(tokenCalls).toHaveLength(0);
  });

  it('removes a token from the caller', async () => {
    await removeUserToken(asBuyer(BUYER, { body: { token: TOKEN } }), r(mockRes()));
    expect(tokenCalls).toEqual([['remove', 'USER', BUYER, [TOKEN]]]);
  });
});

// Rows written before readAt was stored explicitly have no field at all.
describe('notifications with no readAt field', () => {
  const legacy = (over: Partial<Row>): Row => {
    const r = row(over);
    delete r.readAt;
    return r;
  };

  beforeEach(() => {
    table = [legacy({ id: N_BUYER }), row({ id: N_BUYER_READ, readAt: new Date() })];
  });

  it('count as unread', async () => {
    const res = mockRes();
    await listUserNotifications(asBuyer(BUYER), r(res));
    expect(res.body.unreadCount).toBe(1);
  });

  it('can be marked read', async () => {
    const res = mockRes();
    await markUserNotificationRead(asBuyer(BUYER, { params: { id: N_BUYER } }), r(res));
    expect(res.body.readAt).toBeInstanceOf(Date);
    expect(emits).toHaveLength(1);
  });

  it('are included in mark-all-read', async () => {
    const res = mockRes();
    await markAllUserNotificationsRead(asBuyer(BUYER), r(res));
    expect(res.body).toEqual({ updated: 1 });
  });
});
