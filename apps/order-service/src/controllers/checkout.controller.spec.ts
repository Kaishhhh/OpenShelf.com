import type { Request, Response } from 'express';
import { ValidationError } from '@openshelf/errors';
import type { CartResponse } from '@openshelf/types';

const USER = 'user00000000000000000001';

let cart: CartResponse;
const intents: Record<string, unknown>[] = [];
const payments: Record<string, unknown>[] = [];

jest.mock('../utils/cart.store.js', () => ({
  readCart: () => Promise.resolve(new Map()),
}));

jest.mock('../utils/cart.builder.js', () => ({
  buildCart: () => Promise.resolve(cart),
}));

jest.mock('@openshelf/stripe', () => ({
  createPaymentIntent: (input: Record<string, unknown>) => {
    intents.push(input);
    return Promise.resolve({ id: 'pi_1', client_secret: 'pi_1_secret_abc' });
  },
}));

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    payment: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        payments.push(data);
        return Promise.resolve({ id: 'payment_1', ...data });
      },
    },
  },
}));

import { startCheckout } from './checkout.controller.js';

function item(over: Partial<CartResponse['shops'][number]['items'][number]> = {}) {
  return {
    productId: '111111111111111111111111',
    slug: 'mug',
    title: 'Mug',
    image: null,
    price: 12.5,
    originalPrice: null,
    quantity: 2,
    stock: 5,
    lineTotal: 25,
    ...over,
  };
}

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

const req = (body: unknown = {}) =>
  ({ user: { id: USER }, body }) as unknown as Request;

beforeEach(() => {
  intents.length = 0;
  payments.length = 0;
  cart = {
    shops: [
      { shop: { id: 'shopA', name: 'A' }, subtotal: 25, items: [item()] },
      {
        shop: { id: 'shopB', name: 'B' },
        subtotal: 8.5,
        items: [
          item({
            productId: '222222222222222222222222',
            title: 'Bowl',
            price: 8.5,
            originalPrice: 10,
            quantity: 1,
            lineTotal: 8.5,
          }),
        ],
      },
    ],
    total: 33.5,
    itemCount: 3,
    distinctItems: 2,
    notices: [],
  };
});

it('charges the recomputed total in cents and returns the client secret', async () => {
  const res = mockRes();
  await startCheckout(req(), res as unknown as Response);

  expect(res.statusCode).toBe(201);
  expect(intents).toEqual([{ amount: 3350, currency: 'usd', userId: USER }]);
  expect(res.body).toEqual({
    clientSecret: 'pi_1_secret_abc',
    paymentIntentId: 'pi_1',
    amount: 3350,
    currency: 'usd',
  });
});

it('writes a PENDING payment carrying the priced lines the webhook will fulfil', async () => {
  await startCheckout(req(), mockRes() as unknown as Response);

  expect(payments).toEqual([
    {
      userId: USER,
      stripePaymentIntentId: 'pi_1',
      amount: 3350,
      currency: 'usd',
      status: 'PENDING',
      lines: [
        {
          productId: '111111111111111111111111',
          shopId: 'shopA',
          title: 'Mug',
          price: 1250,
          quantity: 2,
        },
        {
          productId: '222222222222222222222222',
          shopId: 'shopB',
          title: 'Bowl',
          price: 850,
          quantity: 1,
        },
      ],
    },
  ]);
});

it('ignores any total or price the client sends', async () => {
  await startCheckout(
    req({ amount: 1, total: 0.01, items: [{ price: 0 }] }),
    mockRes() as unknown as Response
  );
  expect(intents[0]).toMatchObject({ amount: 3350 });
});

it('refuses a cart that changed since the buyer saw it, without charging', async () => {
  cart.notices = [{ type: 'removed', title: 'Plate' }];

  const promise = startCheckout(req(), mockRes() as unknown as Response);
  await expect(promise).rejects.toBeInstanceOf(ValidationError);
  await expect(promise).rejects.toMatchObject({
    statusCode: 400,
    details: [{ type: 'removed', title: 'Plate' }],
  });
  expect(intents).toHaveLength(0);
  expect(payments).toHaveLength(0);
});

it('refuses an empty cart', async () => {
  cart = { shops: [], total: 0, itemCount: 0, distinctItems: 0, notices: [] };
  await expect(
    startCheckout(req(), mockRes() as unknown as Response)
  ).rejects.toThrow('Your cart is empty');
  expect(intents).toHaveLength(0);
});

it('refuses a total below Stripe’s minimum charge', async () => {
  cart.shops = [
    {
      shop: { id: 'shopA', name: 'A' },
      subtotal: 0.4,
      items: [item({ price: 0.4, quantity: 1, lineTotal: 0.4 })],
    },
  ];
  await expect(
    startCheckout(req(), mockRes() as unknown as Response)
  ).rejects.toThrow('minimum order');
  expect(intents).toHaveLength(0);
});
