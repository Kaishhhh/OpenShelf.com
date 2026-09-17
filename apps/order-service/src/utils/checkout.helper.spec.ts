import type { CartResponse } from './cart.helper.js';
import {
  PLATFORM_FEE_RATE,
  computeSplit,
  splitByShop,
  toCents,
  toPricedLines,
  type PricedLine,
} from './checkout.helper.js';

const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  productId: 'p1',
  shopId: 's1',
  title: 'Mug',
  price: 1000,
  quantity: 1,
  ...over,
});

describe('toCents', () => {
  // 19.99 * 100 is 1998.9999999999998 in floating point; truncating would lose a cent.
  it('rounds float dollars to exact cents', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.29)).toBe(29);
    expect(toCents(12)).toBe(1200);
  });
});

describe('toPricedLines', () => {
  it('uses the effective price the cart shows and tags each line with its shop', () => {
    const cart = {
      shops: [
        {
          shop: { id: 's1', name: 'A' },
          subtotal: 0,
          items: [
            {
              productId: 'p1',
              slug: 'mug',
              title: 'Mug',
              image: null,
              price: 8.5,
              originalPrice: 10,
              quantity: 2,
              stock: 5,
              lineTotal: 17,
            },
          ],
        },
      ],
      total: 17,
      itemCount: 2,
      distinctItems: 1,
      notices: [],
    } satisfies CartResponse;

    expect(toPricedLines(cart)).toEqual([
      { productId: 'p1', shopId: 's1', title: 'Mug', price: 850, quantity: 2 },
    ]);
  });
});

describe('splitByShop', () => {
  it('groups lines by shop in first-seen order', () => {
    const groups = splitByShop([
      line({ productId: 'a', shopId: 's2' }),
      line({ productId: 'b', shopId: 's1' }),
      line({ productId: 'c', shopId: 's2' }),
    ]);
    expect([...groups.keys()]).toEqual(['s2', 's1']);
    expect(groups.get('s2')?.map((l) => l.productId)).toEqual(['a', 'c']);
  });
});

describe('computeSplit', () => {
  it('takes the platform rate and gives the seller the rest', () => {
    expect(PLATFORM_FEE_RATE).toBe(0.1);
    expect(computeSplit([line({ price: 1000, quantity: 3 })])).toEqual({
      subtotal: 3000,
      platformFee: 300,
      sellerAmount: 2700,
    });
  });

  // 10% of 1005 is 100.5 — whichever way the fee rounds, fee + seller must be exact.
  it.each([1, 5, 15, 999, 1005, 12_345, 99_999])(
    'fee + seller share equals the subtotal exactly for %i cents',
    (subtotal) => {
      const split = computeSplit([line({ price: subtotal })]);
      expect(split.platformFee + split.sellerAmount).toBe(subtotal);
      expect(Number.isInteger(split.platformFee)).toBe(true);
    }
  );
});
