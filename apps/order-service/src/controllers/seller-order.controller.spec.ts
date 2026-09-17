import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '@openshelf/errors';

/*
 * One Order table holding two shops' orders from the same payment, as checkout writes
 * them. The fake applies the handler's own `where` and `select`, so a handler that forgot
 * shopId would really return the other shop's row, and one that leaked an unselected
 * column would really include it.
 */

const SHOP_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ORDER_A = '0000000000000000000000a1';
const ORDER_A_SHORT = '0000000000000000000000a2';
const ORDER_B = '0000000000000000000000b1';
const PRODUCT_MUG = '111111111111111111111111';

type Status = 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

interface Row {
  id: string;
  shopId: string;
  userId: string;
  paymentId: string;
  status: Status;
  subtotal: number;
  platformFee: number;
  sellerAmount: number;
  stripeTransferId: string | null;
  transferStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  stockShortfall: boolean;
  createdAt: Date;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  user: { name: string; email: string };
  payment: { currency: string; stripePaymentIntentId: string };
  items: {
    id: string;
    orderId: string;
    productId: string;
    title: string;
    price: number;
    quantity: number;
    lineTotal: number;
    stockShortfall: boolean;
  }[];
}

const row = (over: Partial<Row>): Row => ({
  id: ORDER_A,
  shopId: SHOP_A,
  userId: 'buyer00000000000000000001',
  paymentId: 'payment00000000000000001',
  status: 'PAID',
  subtotal: 2500,
  platformFee: 250,
  sellerAmount: 2250,
  stripeTransferId: 'tr_secret_a',
  transferStatus: 'SUCCEEDED',
  stockShortfall: false,
  createdAt: new Date('2026-09-17T10:00:00Z'),
  shippedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  user: { name: 'Kai', email: 'buyer@example.com' },
  payment: { currency: 'usd', stripePaymentIntentId: 'pi_shared_secret' },
  items: [
    {
      id: 'item-a',
      orderId: ORDER_A,
      productId: PRODUCT_MUG,
      title: 'Mug',
      price: 1250,
      quantity: 2,
      lineTotal: 2500,
      stockShortfall: false,
    },
  ],
  ...over,
});

let table: Row[] = [];
const updateCalls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
const findManyCalls: Record<string, unknown>[] = [];

interface Where {
  id?: string;
  shopId?: string;
  status?: Status | { in: Status[] };
}

function matches(r: Row, where: Where): boolean {
  if (where.id !== undefined && r.id !== where.id) return false;
  if (where.shopId !== undefined && r.shopId !== where.shopId) return false;
  if (where.status !== undefined) {
    if (typeof where.status === 'string') {
      if (r.status !== where.status) return false;
    } else if (!where.status.in.includes(r.status)) {
      return false;
    }
  }
  return true;
}

/** Recursively honours Prisma's `select`. */
function project(value: unknown, select: unknown): unknown {
  if (select === true || select === undefined) return value;
  const spec = (select as { select?: unknown }).select ?? select;
  if (Array.isArray(value)) return value.map((v) => project(v, spec));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(spec as Record<string, unknown>).map(([key, sub]) => [
      key,
      project((value as Record<string, unknown>)[key], sub),
    ])
  );
}

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    order: {
      findMany: (args: {
        where: Where;
        select: unknown;
        orderBy: { stockShortfall?: string; createdAt?: string }[];
        skip: number;
        take: number;
      }) => {
        findManyCalls.push(args as unknown as Record<string, unknown>);
        const rows = table
          .filter((r) => matches(r, args.where))
          .sort(
            (a, b) =>
              Number(b.stockShortfall) - Number(a.stockShortfall) ||
              b.createdAt.getTime() - a.createdAt.getTime()
          )
          .slice(args.skip, args.skip + args.take);
        return Promise.resolve(rows.map((r) => project(r, args.select)));
      },
      count: ({ where }: { where: Where }) =>
        Promise.resolve(table.filter((r) => matches(r, where)).length),
      findFirst: ({ where, select }: { where: Where; select: unknown }) => {
        const found = table.find((r) => matches(r, where));
        return Promise.resolve(found ? project(found, select) : null);
      },
      updateMany: ({ where, data }: { where: Where; data: Partial<Row> }) => {
        updateCalls.push({
          where: where as Record<string, unknown>,
          data: data as Record<string, unknown>,
        });
        const hits = table.filter((r) => matches(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hits.length });
      },
    },
    image: {
      findMany: () =>
        Promise.resolve([
          { productId: PRODUCT_MUG, url: 'https://ik.imagekit.io/x/mug-1.jpg' },
          { productId: PRODUCT_MUG, url: 'https://ik.imagekit.io/x/mug-2.jpg' },
        ]),
    },
  },
}));

import {
  getShopOrder,
  listShopOrders,
  updateOrderStatus,
} from './seller-order.controller.js';

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

const req = (
  shopId: string,
  over: { params?: object; query?: object; body?: unknown } = {}
) =>
  ({ shop: { id: shopId }, params: {}, query: {}, body: {}, ...over }) as unknown as Request;

const asRes = (res: ReturnType<typeof mockRes>) => res as unknown as Response;

const FORBIDDEN_KEYS = [
  'userId',
  'paymentId',
  'paymentIntentId',
  'stripeTransferId',
  'shopId',
  'user',
  'payment',
];

function expectNoLeaks(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toContain('buyer@example.com');
  expect(json).not.toContain('pi_shared_secret');
  expect(json).not.toContain('tr_secret');
  expect(json).not.toContain('buyer00000000000000000001');
}

beforeEach(() => {
  updateCalls.length = 0;
  findManyCalls.length = 0;
  table = [
    row({}),
    // Same payment, other shop — the case a missing shopId filter would leak.
    row({
      id: ORDER_B,
      shopId: SHOP_B,
      subtotal: 2955,
      platformFee: 296,
      sellerAmount: 2659,
      stripeTransferId: 'tr_secret_b',
      items: [
        {
          id: 'item-b',
          orderId: ORDER_B,
          productId: '222222222222222222222222',
          title: 'Plate',
          price: 2955,
          quantity: 1,
          lineTotal: 2955,
          stockShortfall: false,
        },
      ],
    }),
  ];
});

describe('listShopOrders', () => {
  it("returns only this shop's orders, with the split", async () => {
    const res = mockRes();
    await listShopOrders(req(SHOP_A), asRes(res));

    const orders = res.body.orders as Record<string, unknown>[];
    expect(orders.map((o) => o.id)).toEqual([ORDER_A]);
    expect(orders[0]).toMatchObject({
      subtotal: 2500,
      platformFee: 250,
      sellerAmount: 2250,
      transferStatus: 'SUCCEEDED',
      currency: 'usd',
      buyer: { name: 'Kai' },
    });
    expect(res.body.total).toBe(1);
  });

  it('ignores a shopId in the query', async () => {
    const res = mockRes();
    await listShopOrders(req(SHOP_A, { query: { shopId: SHOP_B } }), asRes(res));
    expect((res.body.orders as { id: string }[]).map((o) => o.id)).toEqual([ORDER_A]);
    expect(findManyCalls[0]).toMatchObject({ where: { shopId: SHOP_A } });
  });

  it('never exposes buyer identity, payment ids or transfer ids', async () => {
    const res = mockRes();
    await listShopOrders(req(SHOP_A), asRes(res));
    const order = (res.body.orders as Record<string, unknown>[])[0];
    for (const key of FORBIDDEN_KEYS) {
      expect(order).not.toHaveProperty(key);
    }
    expectNoLeaks(res.body);
  });

  it('filters by status', async () => {
    table.push(row({ id: ORDER_A_SHORT, status: 'SHIPPED' }));
    const res = mockRes();
    await listShopOrders(req(SHOP_A, { query: { status: 'SHIPPED' } }), asRes(res));
    expect((res.body.orders as { id: string }[]).map((o) => o.id)).toEqual([ORDER_A_SHORT]);
  });

  it('sorts stock-shortfall orders first, then newest', async () => {
    table.push(
      row({
        id: ORDER_A_SHORT,
        stockShortfall: true,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      })
    );
    const res = mockRes();
    await listShopOrders(req(SHOP_A), asRes(res));
    expect((res.body.orders as { id: string }[]).map((o) => o.id)).toEqual([
      ORDER_A_SHORT,
      ORDER_A,
    ]);
    // The ordering is the query's, so it holds across pages too.
    expect(findManyCalls[0]).toMatchObject({
      orderBy: [{ stockShortfall: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('attaches the first current image of each product', async () => {
    const res = mockRes();
    await listShopOrders(req(SHOP_A), asRes(res));
    const order = (res.body.orders as { items: { image: string | null }[] }[])[0];
    expect(order.items[0].image).toBe('https://ik.imagekit.io/x/mug-1.jpg');
  });
});

describe('getShopOrder', () => {
  it('returns its own order', async () => {
    const res = mockRes();
    await getShopOrder(req(SHOP_A, { params: { id: ORDER_A } }), asRes(res));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: ORDER_A, sellerAmount: 2250 });
    expect((res.body.items as unknown[]).length).toBe(1);
    expectNoLeaks(res.body);
  });

  it("404s another shop's order from the same payment, like a missing one", async () => {
    // Awaited one at a time: a promise created but not yet awaited when an earlier
    // assertion fails becomes an unhandled rejection and crashes the run.
    await expect(
      getShopOrder(req(SHOP_A, { params: { id: ORDER_B } }), asRes(mockRes()))
    ).rejects.toMatchObject({ statusCode: 404, message: 'Order not found' });
    await expect(
      getShopOrder(
        req(SHOP_A, { params: { id: 'ffffffffffffffffffffffff' } }),
        asRes(mockRes())
      )
    ).rejects.toMatchObject({ statusCode: 404, message: 'Order not found' });
  });

  it('404s a malformed id', async () => {
    await expect(
      getShopOrder(req(SHOP_A, { params: { id: 'nope' } }), asRes(mockRes()))
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateOrderStatus', () => {
  const patch = (id: string, status: string, shopId = SHOP_A) => {
    const res = mockRes();
    return updateOrderStatus(
      req(shopId, { params: { id }, body: { status } }),
      asRes(res)
    ).then(() => res);
  };

  it('moves PAID -> SHIPPED -> DELIVERED, stamping each step', async () => {
    const shipped = await patch(ORDER_A, 'SHIPPED');
    expect(shipped.statusCode).toBe(200);
    expect(shipped.body).toMatchObject({
      order: { status: 'SHIPPED' },
      refundRequired: false,
    });
    expect((shipped.body.order as { shippedAt: string | null }).shippedAt).not.toBeNull();

    const delivered = await patch(ORDER_A, 'DELIVERED');
    expect((delivered.body.order as { status: string; deliveredAt: string | null })).toMatchObject({
      status: 'DELIVERED',
    });
    expect((delivered.body.order as { deliveredAt: string | null }).deliveredAt).not.toBeNull();
    expectNoLeaks(delivered.body);
  });

  it('cancels a PAID order and flags that a refund is required', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await patch(ORDER_A, 'CANCELLED');
    expect(res.body).toMatchObject({ order: { status: 'CANCELLED' }, refundRequired: true });
    expect((res.body.order as { cancelledAt: string | null }).cancelledAt).not.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each<[Status, string]>([
    ['PAID', 'DELIVERED'],
    ['PAID', 'PAID'],
    ['PAID', 'PENDING'],
    ['SHIPPED', 'CANCELLED'],
    ['SHIPPED', 'SHIPPED'],
    ['SHIPPED', 'PAID'],
    ['DELIVERED', 'SHIPPED'],
    ['DELIVERED', 'CANCELLED'],
    ['CANCELLED', 'SHIPPED'],
    ['CANCELLED', 'PAID'],
  ])('rejects %s -> %s with a 400 naming both, and changes nothing', async (from, to) => {
    table[0].status = from;
    const before = JSON.stringify(table[0]);

    const promise = patch(ORDER_A, to);
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({
      statusCode: 400,
      message: `Cannot change order from ${from} to ${to}`,
      details: { currentStatus: from, attemptedStatus: to },
    });
    expect(JSON.stringify(table[0])).toBe(before);
  });

  it('400s an unknown status', async () => {
    await expect(patch(ORDER_A, 'REFUNDED')).rejects.toBeInstanceOf(ValidationError);
  });

  it("404s a transition on another shop's order, and does not change it", async () => {
    await expect(patch(ORDER_B, 'SHIPPED')).rejects.toBeInstanceOf(NotFoundError);
    expect(table.find((r) => r.id === ORDER_B)?.status).toBe('PAID');
  });

  // The write itself carries the preconditions, so a stale read cannot slip past them.
  it('writes as one compare-and-set scoped to the shop and the legal sources', async () => {
    await patch(ORDER_A, 'DELIVERED').catch(() => undefined);
    await patch(ORDER_A, 'SHIPPED');
    expect(updateCalls).toEqual([
      {
        where: { id: ORDER_A, shopId: SHOP_A, status: { in: ['SHIPPED'] } },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      },
      {
        where: { id: ORDER_A, shopId: SHOP_A, status: { in: ['PAID'] } },
        data: expect.objectContaining({ status: 'SHIPPED' }),
      },
    ]);
  });

  it('never writes for a target nothing can reach', async () => {
    await patch(ORDER_A, 'PAID').catch(() => undefined);
    expect(updateCalls).toHaveLength(0);
  });

  it('ignores a shopId sent in the body', async () => {
    await expect(
      updateOrderStatus(
        req(SHOP_A, { params: { id: ORDER_B }, body: { status: 'SHIPPED', shopId: SHOP_B } }),
        asRes(mockRes())
      )
    ).rejects.toBeInstanceOf(ValidationError); // strict body: the extra key is refused
    expect(table.find((r) => r.id === ORDER_B)?.status).toBe('PAID');
  });
});
