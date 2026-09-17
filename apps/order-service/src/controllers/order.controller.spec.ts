import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '@openshelf/errors';

const ALICE = 'aaaa00000000000000000001';
const BOB = 'bbbb00000000000000000002';
const ALICE_ORDER = '000000000000000000000001';
const BOB_ORDER = '000000000000000000000002';

interface Row {
  id: string;
  userId: string;
  status: string;
  subtotal: number;
  platformFee: number;
  sellerAmount: number;
  stripeTransferId: string;
  transferStatus: string;
  stockShortfall: boolean;
  createdAt: Date;
  shop: { id: string; name: string };
  payment: { stripePaymentIntentId: string; currency: string };
  items: unknown[];
}

const row = (over: Partial<Row>): Row => ({
  id: ALICE_ORDER,
  userId: ALICE,
  status: 'PAID',
  subtotal: 2500,
  platformFee: 250,
  sellerAmount: 2250,
  stripeTransferId: 'tr_secret',
  transferStatus: 'SUCCEEDED',
  stockShortfall: false,
  createdAt: new Date('2026-09-16T00:00:00Z'),
  shop: { id: 'shopA', name: 'Shop A' },
  payment: { stripePaymentIntentId: 'pi_alice', currency: 'usd' },
  items: [],
  ...over,
});

let table: Row[] = [];

interface Where {
  id?: string;
  userId?: string;
  payment?: { is: { stripePaymentIntentId: string } };
}

const matches = (r: Row, where: Where) =>
  (where.id === undefined || r.id === where.id) &&
  (where.userId === undefined || r.userId === where.userId) &&
  (where.payment === undefined ||
    r.payment.stripePaymentIntentId === where.payment.is.stripePaymentIntentId);

/**
 * Honours `select` the way Prisma does, so a response that leaks an unselected field
 * fails here rather than passing because the fake handed back the whole row.
 */
function project(r: Row, select: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(select).map((key) => [key, r[key as keyof Row]])
  );
}

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    order: {
      findMany: ({ where, select }: { where: Where; select: Record<string, unknown> }) =>
        Promise.resolve(
          table.filter((r) => matches(r, where)).map((r) => project(r, select))
        ),
      count: ({ where }: { where: Where }) =>
        Promise.resolve(table.filter((r) => matches(r, where)).length),
      findFirst: ({ where, select }: { where: Where; select: Record<string, unknown> }) => {
        const found = table.find((r) => matches(r, where));
        return Promise.resolve(found ? project(found, select) : null);
      },
    },
  },
}));

import { getOrder, listOrders } from './order.controller.js';

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
  };
  return res;
}

const req = (userId: string, over: { params?: object; query?: object } = {}) =>
  ({ user: { id: userId }, params: {}, query: {}, ...over }) as unknown as Request;

beforeEach(() => {
  table = [
    row({}),
    row({
      id: BOB_ORDER,
      userId: BOB,
      payment: { stripePaymentIntentId: 'pi_bob', currency: 'usd' },
    }),
  ];
});

describe('getOrder', () => {
  it('returns the buyer their own order', async () => {
    const res = mockRes();
    await getOrder(req(ALICE, { params: { id: ALICE_ORDER } }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      id: ALICE_ORDER,
      paymentIntentId: 'pi_alice',
      currency: 'usd',
      createdAt: '2026-09-16T00:00:00.000Z',
    });
  });

  it("404s another buyer's order, exactly like a missing one", async () => {
    const other = getOrder(
      req(ALICE, { params: { id: BOB_ORDER } }),
      mockRes() as unknown as Response
    );
    await expect(other).rejects.toBeInstanceOf(NotFoundError);

    const missing = getOrder(
      req(ALICE, { params: { id: 'ffffffffffffffffffffffff' } }),
      mockRes() as unknown as Response
    );
    await expect(missing).rejects.toBeInstanceOf(NotFoundError);
    await expect(other).rejects.toMatchObject({ message: 'Order not found' });
    await expect(missing).rejects.toMatchObject({ message: 'Order not found' });
  });

  it('404s a malformed id rather than letting Prisma 500', async () => {
    await expect(
      getOrder(req(ALICE, { params: { id: 'nope' } }), mockRes() as unknown as Response)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never exposes how the payment was split', async () => {
    const res = mockRes();
    await getOrder(req(ALICE, { params: { id: ALICE_ORDER } }), res as unknown as Response);
    for (const key of ['platformFee', 'sellerAmount', 'stripeTransferId', 'transferStatus', 'userId']) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(JSON.stringify(res.body)).not.toContain('tr_secret');
  });
});

describe('listOrders', () => {
  it("returns only the caller's orders", async () => {
    const res = mockRes();
    await listOrders(req(ALICE), res as unknown as Response);
    const orders = res.body.orders as { id: string }[];
    expect(orders.map((o) => o.id)).toEqual([ALICE_ORDER]);
    expect(res.body.total).toBe(1);
  });

  // Polling on someone else's intent id must not surface their orders.
  it("returns nothing for another buyer's payment intent", async () => {
    const res = mockRes();
    await listOrders(
      req(ALICE, { query: { paymentIntentId: 'pi_bob' } }),
      res as unknown as Response
    );
    expect(res.body.orders).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('narrows to one checkout by payment intent', async () => {
    table.push(
      row({
        id: '000000000000000000000003',
        payment: { stripePaymentIntentId: 'pi_alice2', currency: 'usd' },
      })
    );
    const res = mockRes();
    await listOrders(
      req(ALICE, { query: { paymentIntentId: 'pi_alice2' } }),
      res as unknown as Response
    );
    expect((res.body.orders as { id: string }[]).map((o) => o.id)).toEqual([
      '000000000000000000000003',
    ]);
  });

  it('400s a malformed payment intent id', async () => {
    await expect(
      listOrders(
        req(ALICE, { query: { paymentIntentId: '{"$ne":null}' } }),
        mockRes() as unknown as Response
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
