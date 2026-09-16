import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '@openshelf/errors';

const USER = 'user-1';
const PRODUCT_A = '111111111111111111111111';
const PRODUCT_B = '222222222222222222222222';
const SHOP_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

interface FakeProduct {
  id: string;
  title: string;
  slug: string;
  price: number;
  salePrice: number | null;
  stock: number;
  status: 'ACTIVE' | 'DRAFT' | 'DELETED';
  shop: {
    id: string;
    name: string;
    status: 'APPROVED' | 'PENDING' | 'REJECTED';
    seller: { stripeChargesEnabled: boolean };
  };
  images: { url: string }[];
}

function makeProduct(over: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id: PRODUCT_A,
    title: 'Mug',
    slug: 'mug',
    price: 20,
    salePrice: null,
    stock: 5,
    status: 'ACTIVE',
    shop: {
      id: SHOP_A,
      name: 'Shop A',
      status: 'APPROVED',
      seller: { stripeChargesEnabled: true },
    },
    images: [],
    ...over,
  };
}

let products: FakeProduct[] = [];
/** The Redis hash, stood in for by the store module's own surface. */
let stored: Map<string, number>;
const removed: string[][] = [];

interface FindFirstArgs {
  where: {
    id: string;
    status: string;
    shop: { is: { status: string } };
  };
}

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    product: {
      // Applies the handler's own where, so dropping a condition from it fails here.
      findFirst: ({ where }: FindFirstArgs) =>
        Promise.resolve(
          products.find(
            (p) =>
              p.id === where.id &&
              p.status === where.status &&
              p.shop.status === where.shop.is.status
          ) ?? null
        ),
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(products.filter((p) => where.id.in.includes(p.id))),
    },
  },
}));

jest.mock('../utils/cart.store.js', () => ({
  readCart: () => Promise.resolve(new Map(stored)),
  addItem: (_user: string, productId: string, quantity: number) => {
    stored.set(productId, (stored.get(productId) ?? 0) + quantity);
    return Promise.resolve(stored.get(productId));
  },
  setItem: (_user: string, productId: string, quantity: number) => {
    stored.set(productId, quantity);
    return Promise.resolve(quantity);
  },
  removeItem: (_user: string, productId: string) =>
    Promise.resolve(stored.delete(productId)),
  removeItems: (_user: string, ids: string[]) => {
    removed.push(ids);
    ids.forEach((id) => stored.delete(id));
    return Promise.resolve();
  },
  clearCart: () => {
    stored.clear();
    return Promise.resolve();
  },
}));

import { addCartItem, getCart, updateCartItem } from './cart.controller.js';

interface MockRes extends Response {
  statusCode: number;
  body: {
    shops: { items: { productId: string }[] }[];
    total: number;
    itemCount: number;
    distinctItems: number;
    notices: { type: string; title: string }[];
  };
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as MockRes;
}

function mockReq(over: { params?: object; body?: unknown } = {}) {
  return {
    params: {},
    body: {},
    user: { id: USER },
    ...over,
  } as unknown as Request;
}

beforeEach(() => {
  products = [
    makeProduct(),
    makeProduct({
      id: PRODUCT_B,
      title: 'Bowl',
      slug: 'bowl',
      price: 10,
      shop: {
        id: SHOP_B,
        name: 'Shop B',
        status: 'APPROVED',
        seller: { stripeChargesEnabled: true },
      },
    }),
  ];
  stored = new Map();
  removed.length = 0;
});

describe('addCartItem', () => {
  it('adds a product whose seller can receive funds', async () => {
    const res = mockRes();
    await addCartItem(mockReq({ body: { productId: PRODUCT_A } }), res);
    expect(res.statusCode).toBe(200);
    expect(stored.get(PRODUCT_A)).toBe(1);
  });

  it('400s, without storing, when the seller cannot receive funds', async () => {
    products[0].shop.seller.stripeChargesEnabled = false;
    const promise = addCartItem(
      mockReq({ body: { productId: PRODUCT_A } }),
      mockRes()
    );
    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ statusCode: 400 });
    expect(stored.has(PRODUCT_A)).toBe(false);
  });

  // The charges check must not replace the visibility check: a hidden product is
  // still the uniform 404, whatever its seller's Stripe state.
  it('still 404s a DRAFT product', async () => {
    products[0].status = 'DRAFT';
    await expect(
      addCartItem(mockReq({ body: { productId: PRODUCT_A } }), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('still 404s a product from an unapproved shop', async () => {
    products[0].shop.status = 'PENDING';
    products[0].shop.seller.stripeChargesEnabled = false;
    await expect(
      addCartItem(mockReq({ body: { productId: PRODUCT_A } }), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateCartItem', () => {
  it('400s when the seller lost charges after the item was added', async () => {
    stored.set(PRODUCT_A, 1);
    products[0].shop.seller.stripeChargesEnabled = false;
    await expect(
      updateCartItem(
        mockReq({ params: { productId: PRODUCT_A }, body: { quantity: 2 } }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(stored.get(PRODUCT_A)).toBe(1);
  });
});

describe('getCart', () => {
  it('prunes an item whose seller can no longer receive funds, with a notice', async () => {
    stored.set(PRODUCT_A, 2);
    stored.set(PRODUCT_B, 1);
    products[0].shop.seller.stripeChargesEnabled = false;

    const res = mockRes();
    await getCart(mockReq(), res);

    expect(res.statusCode).toBe(200);
    expect(removed).toEqual([[PRODUCT_A]]);
    expect(stored.has(PRODUCT_A)).toBe(false);
    expect(res.body.notices).toEqual([{ type: 'removed', title: 'Mug' }]);
    expect(
      res.body.shops.flatMap((s) => s.items.map((i) => i.productId))
    ).toEqual([PRODUCT_B]);
    expect(res.body.total).toBe(10);
    expect(res.body.itemCount).toBe(1);
  });

  it('keeps items from charges-enabled sellers and never exposes seller fields', async () => {
    stored.set(PRODUCT_A, 1);

    const res = mockRes();
    await getCart(mockReq(), res);

    expect(removed).toEqual([[]]);
    expect(res.body.notices).toEqual([]);
    expect(res.body.total).toBe(20);
    expect(JSON.stringify(res.body)).not.toContain('seller');
  });
});
