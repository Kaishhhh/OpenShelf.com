import type { Request, Response } from 'express';
import { ValidationError } from '@openshelf/errors';

/*
 * An in-memory database with real transaction semantics: $transaction snapshots every
 * table and restores it if the callback throws. The idempotency and rollback guarantees
 * under test are exactly what a fake that ignored transactions would hide.
 */

const USER = 'user00000000000000000001';
const SHOP_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const MUG = '111111111111111111111111';
const BOWL = '222222222222222222222222';
const PLATE = '333333333333333333333333';
const PI = 'pi_test_1';
const CHARGE = 'ch_test_1';

interface Line {
  productId: string;
  shopId: string;
  title: string;
  price: number;
  quantity: number;
}

interface PaymentRow {
  id: string;
  userId: string;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  lines: Line[];
}

interface OrderRow {
  id: string;
  paymentId: string;
  shopId: string;
  userId: string;
  status: string;
  subtotal: number;
  platformFee: number;
  sellerAmount: number;
  stripeTransferId: string | null;
  transferStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  stockShortfall: boolean;
  items: {
    productId: string;
    title: string;
    price: number;
    quantity: number;
    lineTotal: number;
    stockShortfall: boolean;
  }[];
}

interface Db {
  payments: PaymentRow[];
  orders: OrderRow[];
  stock: Record<string, number>;
  sellers: Record<string, string | null>;
}

let db: Db;
let nextOrderId = 1;
/** Throws inside order.create when set — simulates a failure mid-fan-out. */
let failOrderCreateForShop: string | null = null;
let transferImpl: (input: { orderId: string; destination: string }) => Promise<{ id: string }>;
const transferCalls: Record<string, unknown>[] = [];
const cartRemovals: { userId: string; ids: string[] }[] = [];
const events: string[] = [];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function paymentModel() {
  return {
    findUnique: ({ where }: { where: { stripePaymentIntentId: string } }) =>
      Promise.resolve(
        clone(
          db.payments.find(
            (p) => p.stripePaymentIntentId === where.stripePaymentIntentId
          ) ?? null
        )
      ),
    updateMany: ({
      where,
      data,
    }: {
      where: {
        id?: string;
        stripePaymentIntentId?: string;
        status: PaymentRow['status'] | { not: PaymentRow['status'] };
      };
      data: Partial<PaymentRow>;
    }) => {
      const hits = db.payments.filter(
        (p) =>
          (where.id === undefined || p.id === where.id) &&
          (where.stripePaymentIntentId === undefined ||
            p.stripePaymentIntentId === where.stripePaymentIntentId) &&
          (typeof where.status === 'string'
            ? p.status === where.status
            : p.status !== where.status.not)
      );
      hits.forEach((p) => Object.assign(p, data));
      return Promise.resolve({ count: hits.length });
    },
  };
}

function orderModel() {
  return {
    create: ({ data }: { data: Omit<OrderRow, 'id' | 'items' | 'stripeTransferId'> & { items: { create: OrderRow['items'] } } }) => {
      if (failOrderCreateForShop === data.shopId) {
        return Promise.reject(new Error('simulated write failure'));
      }
      const { items, ...rest } = data;
      const row: OrderRow = {
        ...rest,
        id: `order${String(nextOrderId++).padStart(19, '0')}`,
        stripeTransferId: null,
        items: items.create,
      };
      db.orders.push(row);
      events.push(`order.create:${row.shopId}`);
      return Promise.resolve(row);
    },
    findMany: ({ where }: { where: { paymentId: string; transferStatus: string } }) =>
      Promise.resolve(
        db.orders
          .filter(
            (o) =>
              o.paymentId === where.paymentId &&
              o.transferStatus === where.transferStatus
          )
          .map((o) => ({
            id: o.id,
            sellerAmount: o.sellerAmount,
            shop: { seller: { stripeId: db.sellers[o.shopId] } },
          }))
      ),
    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; transferStatus: string };
      data: Partial<OrderRow>;
    }) => {
      const hits = db.orders.filter(
        (o) => o.id === where.id && o.transferStatus === where.transferStatus
      );
      hits.forEach((o) => Object.assign(o, data));
      return Promise.resolve({ count: hits.length });
    },
  };
}

function productModel() {
  return {
    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; stock: { gte: number } };
      data: { stock: { decrement: number } };
    }) => {
      const stock = db.stock[where.id];
      if (stock === undefined || stock < where.stock.gte) {
        return Promise.resolve({ count: 0 });
      }
      db.stock[where.id] = stock - data.stock.decrement;
      return Promise.resolve({ count: 1 });
    },
  };
}

jest.mock('@openshelf/prisma', () => {
  const client = {
    payment: paymentModel(),
    order: orderModel(),
    product: productModel(),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = clone(db);
      try {
        return await fn(client);
      } catch (err) {
        db = snapshot;
        throw err;
      }
    },
  };
  return { prisma: client };
});

jest.mock('../utils/cart.store.js', () => ({
  removeItems: (userId: string, ids: string[]) => {
    cartRemovals.push({ userId, ids });
    events.push('cart.remove');
    return Promise.resolve();
  },
}));

const emitted: Record<string, unknown>[] = [];
jest.mock('../utils/events.js', () => ({
  emitOrderCreated: (payload: Record<string, unknown>) => {
    emitted.push(payload);
    events.push(`emit:${payload.shopId}`);
    return Promise.resolve();
  },
}));

let verified: unknown;
jest.mock('@openshelf/stripe', () => ({
  verifyWebhookEvent: () => verified,
  createTransfer: (input: { orderId: string; destination: string }) => {
    transferCalls.push(input as unknown as Record<string, unknown>);
    events.push(`transfer:${input.orderId}`);
    return transferImpl(input);
  },
}));

import { handlePaymentsWebhook } from './webhook.controller.js';

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

function deliver(type: string, intent: Record<string, unknown>) {
  verified = { id: 'evt_1', type, data: { object: intent } };
  const req = {
    body: Buffer.from('{}'),
    headers: { 'stripe-signature': 't=1,v1=sig' },
  } as unknown as Request;
  const res = mockRes();
  return handlePaymentsWebhook(req, res as unknown as Response).then(() => res);
}

const succeeded = (over: Record<string, unknown> = {}) =>
  deliver('payment_intent.succeeded', {
    id: PI,
    amount_received: 6450,
    currency: 'usd',
    latest_charge: CHARGE,
    ...over,
  });

beforeEach(() => {
  nextOrderId = 1;
  failOrderCreateForShop = null;
  transferCalls.length = 0;
  cartRemovals.length = 0;
  events.length = 0;
  emitted.length = 0;
  transferImpl = ({ orderId }) => Promise.resolve({ id: `tr_${orderId}` });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  // Shop A: 2 mugs at $12.50 and 1 bowl at $9.95 = 3495. Shop B: 1 plate at $29.55.
  db = {
    payments: [
      {
        id: 'payment00000000000000001',
        userId: USER,
        stripePaymentIntentId: PI,
        amount: 6450,
        currency: 'usd',
        status: 'PENDING',
        lines: [
          { productId: MUG, shopId: SHOP_A, title: 'Mug', price: 1250, quantity: 2 },
          { productId: PLATE, shopId: SHOP_B, title: 'Plate', price: 2955, quantity: 1 },
          { productId: BOWL, shopId: SHOP_A, title: 'Bowl', price: 995, quantity: 1 },
        ],
      },
    ],
    orders: [],
    stock: { [MUG]: 5, [BOWL]: 1, [PLATE]: 3 },
    sellers: { [SHOP_A]: 'acct_a', [SHOP_B]: 'acct_b' },
  };
});

afterEach(() => jest.restoreAllMocks());

describe('signature', () => {
  it('400s an unverifiable request and writes nothing', async () => {
    verified = null;
    const req = {
      body: Buffer.from('{}'),
      headers: {},
    } as unknown as Request;
    await expect(
      handlePaymentsWebhook(req, mockRes() as unknown as Response)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(db.orders).toHaveLength(0);
  });

  it('refuses a body that was already parsed', async () => {
    const req = { body: {}, headers: {} } as unknown as Request;
    await expect(
      handlePaymentsWebhook(req, mockRes() as unknown as Response)
    ).rejects.toThrow('mount the route ahead of express.json()');
  });
});

describe('payment_intent.succeeded', () => {
  it('creates one order per shop with an exact split', async () => {
    const res = await succeeded();

    expect(res.statusCode).toBe(200);
    expect(db.payments[0].status).toBe('SUCCEEDED');
    expect(db.orders).toHaveLength(2);

    const a = db.orders.find((o) => o.shopId === SHOP_A);
    const b = db.orders.find((o) => o.shopId === SHOP_B);
    expect(a).toMatchObject({
      status: 'PAID',
      userId: USER,
      subtotal: 3495,
      platformFee: 350, // 349.5 rounds up
      sellerAmount: 3145,
    });
    expect(a?.items.map((i) => [i.title, i.lineTotal])).toEqual([
      ['Mug', 2500],
      ['Bowl', 995],
    ]);
    expect(b).toMatchObject({ subtotal: 2955, platformFee: 296, sellerAmount: 2659 });

    // Everything reconciles to what Stripe charged.
    const orders = db.orders;
    expect(orders.reduce((s, o) => s + o.subtotal, 0)).toBe(6450);
    for (const o of orders) {
      expect(o.platformFee + o.sellerAmount).toBe(o.subtotal);
    }
  });

  it('decrements stock by each line', async () => {
    await succeeded();
    expect(db.stock).toEqual({ [MUG]: 3, [BOWL]: 0, [PLATE]: 2 });
  });

  it('makes one transfer per order, of the seller share, from the charge', async () => {
    await succeeded();

    expect(transferCalls).toHaveLength(2);
    const a = db.orders.find((o) => o.shopId === SHOP_A);
    expect(transferCalls).toContainEqual({
      amount: 3145,
      currency: 'usd',
      destination: 'acct_a',
      sourceTransaction: CHARGE,
      transferGroup: PI,
      orderId: a?.id,
    });
    expect(db.orders.every((o) => o.transferStatus === 'SUCCEEDED')).toBe(true);
    expect(a?.stripeTransferId).toBe(`tr_${a?.id}`);
  });

  it('removes only the paid lines from the cart, after the orders are written', async () => {
    await succeeded();

    expect(cartRemovals).toEqual([{ userId: USER, ids: [MUG, PLATE, BOWL] }]);
    expect(events.indexOf('cart.remove')).toBeGreaterThan(
      events.lastIndexOf('order.create:' + SHOP_A)
    );
  });

  describe('a replayed delivery', () => {
    it('creates no orders, touches no stock, makes no transfers and leaves the cart alone', async () => {
      await succeeded();
      const ordersAfterFirst = clone(db.orders);
      const stockAfterFirst = { ...db.stock };
      transferCalls.length = 0;
      cartRemovals.length = 0;

      const res = await succeeded();

      expect(res.statusCode).toBe(200);
      expect(res.body.applied).toBe(false);
      expect(db.orders).toEqual(ordersAfterFirst);
      expect(db.stock).toEqual(stockAfterFirst);
      expect(transferCalls).toHaveLength(0);
      expect(cartRemovals).toHaveLength(0);
    });
  });

  it('flags an item that sold out since checkout, still creates the order, and leaves stock alone', async () => {
    db.stock[BOWL] = 0;

    await succeeded();

    const a = db.orders.find((o) => o.shopId === SHOP_A);
    expect(a?.stockShortfall).toBe(true);
    expect(a?.items.find((i) => i.productId === BOWL)?.stockShortfall).toBe(true);
    expect(a?.items.find((i) => i.productId === MUG)?.stockShortfall).toBe(false);
    expect(db.stock[BOWL]).toBe(0);
    expect(db.stock[MUG]).toBe(3);
    // The shop without a shortfall is not flagged.
    expect(db.orders.find((o) => o.shopId === SHOP_B)?.stockShortfall).toBe(false);
  });

  it('treats a product that no longer exists as a shortfall', async () => {
    delete db.stock[PLATE];
    await succeeded();
    expect(db.orders.find((o) => o.shopId === SHOP_B)?.stockShortfall).toBe(true);
  });

  describe('when one transfer fails', () => {
    beforeEach(() => {
      transferImpl = ({ orderId, destination }) =>
        destination === 'acct_b'
          ? Promise.reject(new Error('capability inactive'))
          : Promise.resolve({ id: `tr_${orderId}` });
    });

    it('records it FAILED, completes the other, and still answers 200', async () => {
      const res = await succeeded();

      expect(res.statusCode).toBe(200);
      expect(db.orders.find((o) => o.shopId === SHOP_A)?.transferStatus).toBe('SUCCEEDED');
      expect(db.orders.find((o) => o.shopId === SHOP_B)).toMatchObject({
        transferStatus: 'FAILED',
        stripeTransferId: null,
      });
    });

    it('does not re-attempt either transfer on a replay', async () => {
      await succeeded();
      transferCalls.length = 0;

      await succeeded();

      expect(transferCalls).toHaveLength(0);
    });
  });

  it('records FAILED for a seller with no connected account without calling Stripe for it', async () => {
    db.sellers[SHOP_B] = null;
    await succeeded();
    expect(db.orders.find((o) => o.shopId === SHOP_B)?.transferStatus).toBe('FAILED');
    expect(transferCalls.map((c) => c.destination)).toEqual(['acct_a']);
  });

  // A delivery that crashed after committing orders left transfers PENDING. The retry
  // must finish them — and only them.
  it('completes transfers left PENDING by an earlier delivery', async () => {
    // Simulate the crash: orders committed, but the process died before any transfer
    // outcome was recorded, so both are still PENDING.
    transferImpl = () => Promise.reject(new Error('process died'));
    await succeeded();
    db.orders.forEach((o) => {
      o.transferStatus = 'PENDING';
    });
    transferCalls.length = 0;
    transferImpl = ({ orderId }) => Promise.resolve({ id: `tr_${orderId}` });

    await succeeded();

    expect(transferCalls).toHaveLength(2);
    expect(db.orders).toHaveLength(2);
    expect(db.orders.every((o) => o.transferStatus === 'SUCCEEDED')).toBe(true);
  });

  it('rolls everything back when writing an order fails, so the retry starts clean', async () => {
    failOrderCreateForShop = SHOP_B;

    await expect(succeeded()).rejects.toThrow('simulated write failure');

    expect(db.payments[0].status).toBe('PENDING');
    expect(db.orders).toHaveLength(0);
    expect(db.stock).toEqual({ [MUG]: 5, [BOWL]: 1, [PLATE]: 3 });
    expect(cartRemovals).toHaveLength(0);
    expect(transferCalls).toHaveLength(0);

    failOrderCreateForShop = null;
    const res = await succeeded();
    expect(res.statusCode).toBe(200);
    expect(db.orders).toHaveLength(2);
  });

  it('does not fulfil a charge whose amount disagrees with the payment', async () => {
    const res = await succeeded({ amount_received: 100 });
    expect(res.statusCode).toBe(200);
    expect(db.orders).toHaveLength(0);
    expect(db.payments[0].status).toBe('PENDING');
  });

  it('acknowledges an intent it has no payment for', async () => {
    const res = await succeeded({ id: 'pi_unknown' });
    expect(res.statusCode).toBe(200);
    expect(db.orders).toHaveLength(0);
  });
});

describe('payment_intent.payment_failed', () => {
  it('marks the payment FAILED, creates nothing and leaves the cart alone', async () => {
    const res = await deliver('payment_intent.payment_failed', { id: PI });

    expect(res.statusCode).toBe(200);
    expect(db.payments[0].status).toBe('FAILED');
    expect(db.orders).toHaveLength(0);
    expect(cartRemovals).toHaveLength(0);
    expect(db.stock).toEqual({ [MUG]: 5, [BOWL]: 1, [PLATE]: 3 });
  });

  // A decline is not final: the buyer can retry another card on the same intent.
  it('still lets a later success claim the payment', async () => {
    await deliver('payment_intent.payment_failed', { id: PI });
    await succeeded();
    expect(db.payments[0].status).toBe('SUCCEEDED');
    expect(db.orders).toHaveLength(2);
  });

  it('never downgrades a payment that already succeeded', async () => {
    await succeeded();
    await deliver('payment_intent.payment_failed', { id: PI });
    expect(db.payments[0].status).toBe('SUCCEEDED');
  });
});

it('acknowledges event types it does not handle', async () => {
  const res = await deliver('charge.refunded', { id: 'ch_1' });
  expect(res.statusCode).toBe(200);
  expect(db.orders).toHaveLength(0);
});

describe('order.created events', () => {
  it('emits one per shop order, with identifiers and the per-shop subtotal', async () => {
    await succeeded();

    const a = db.orders.find((o) => o.shopId === SHOP_A);
    const b = db.orders.find((o) => o.shopId === SHOP_B);
    expect(emitted).toEqual([
      {
        orderId: a?.id,
        shopId: SHOP_A,
        userId: USER,
        status: 'PAID',
        subtotal: 3495,
        currency: 'usd',
      },
      {
        orderId: b?.id,
        shopId: SHOP_B,
        userId: USER,
        status: 'PAID',
        subtotal: 2955,
        currency: 'usd',
      },
    ]);
  });

  // The transaction resolves before the cart prune, which runs before any emit.
  it('emits only after the orders are committed', async () => {
    await succeeded();
    const lastWrite = Math.max(
      events.indexOf(`order.create:${SHOP_A}`),
      events.indexOf(`order.create:${SHOP_B}`)
    );
    const firstEmit = events.findIndex((e) => e.startsWith('emit:'));
    expect(events.indexOf('cart.remove')).toBeGreaterThan(lastWrite);
    expect(firstEmit).toBeGreaterThan(events.indexOf('cart.remove'));
  });

  it('emits nothing on a replayed delivery', async () => {
    await succeeded();
    emitted.length = 0;
    await succeeded();
    expect(emitted).toHaveLength(0);
  });

  it('emits nothing when writing the orders fails', async () => {
    failOrderCreateForShop = SHOP_B;
    await expect(succeeded()).rejects.toThrow('simulated write failure');
    expect(emitted).toHaveLength(0);
  });

  it('emits nothing for a declined payment', async () => {
    await deliver('payment_intent.payment_failed', { id: PI });
    expect(emitted).toHaveLength(0);
  });
});
