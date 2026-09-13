import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { Redis } from 'ioredis';

/**
 * End-to-end proof of the cart's storage guarantee and its pruning rules.
 *
 * The claim under test: **Redis holds only productId and quantity.** Everything a
 * buyer sees — price above all — is read from MongoDB on every request, so a price the
 * seller changed after the item went in the cart can never be the price at checkout.
 * Section 2 checks that by changing the price behind the cart's back and by reading the
 * Redis key directly.
 *
 * Runs through Node directly (not Nx/webpack), so per CLAUDE.md it imports only npm
 * packages — no @openshelf/* libs.
 *
 * Prerequisites: MongoDB Atlas unpaused, Redis reachable, and the gateway,
 * auth-service, product-service and order-service all serving.
 *
 *   node -r @swc-node/register tools/verify-cart.ts
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';
const BCRYPT_COST = 12;
const PASSWORD = 'password123';

const BUYER_EMAIL = 'cart-buyer@openshelf.test';
const SELLERS = [
  { key: 'A', email: 'cart-seller-a@openshelf.test', shop: 'Cart Shop A' },
  { key: 'B', email: 'cart-seller-b@openshelf.test', shop: 'Cart Shop B' },
] as const;

const prisma = new PrismaClient();

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set');
}
const redis = new Redis(process.env.REDIS_URL);

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Never throws on 4xx/5xx — the status is what's under test. */
async function request(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  opts: { cookie?: string; body?: unknown } = {}
): Promise<AxiosResponse> {
  try {
    return await axios.request({
      method,
      url: `${GATEWAY}${path}`,
      data: opts.body,
      headers: opts.cookie ? { Cookie: opts.cookie } : {},
      validateStatus: () => true,
    });
  } catch (err) {
    const axiosErr = err as AxiosError;
    throw new Error(
      `Request ${method.toUpperCase()} ${path} failed to reach the gateway: ` +
        `${axiosErr.message}. Are the gateway, auth-service, product-service ` +
        `and order-service all running?`
    );
  }
}

// --- fixtures -------------------------------------------------------------

interface Fixtures {
  buyerId: string;
  cookie: string;
  /** Shop A's products, and one from shop B. */
  productIds: Record<string, string>;
  shopIds: Record<string, string>;
}

async function cleanup() {
  const buyer = await prisma.user.findUnique({
    where: { email: BUYER_EMAIL },
    select: { id: true },
  });
  if (buyer) {
    await redis.del(`cart:${buyer.id}`);
    await prisma.user.delete({ where: { id: buyer.id } });
  }

  const sellers = await prisma.seller.findMany({
    where: { email: { in: SELLERS.map((s) => s.email) } },
    select: { id: true },
  });
  const sellerIds = sellers.map((s) => s.id);
  if (sellerIds.length === 0) return;

  const shops = await prisma.shop.findMany({
    where: { sellerId: { in: sellerIds } },
    select: { id: true },
  });
  const shopIds = shops.map((s) => s.id);

  if (shopIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { shopId: { in: shopIds } },
      select: { id: true },
    });
    // Image rows first: they point at products, and Mongo has no cascade.
    await prisma.image.deleteMany({
      where: { productId: { in: products.map((p) => p.id) } },
    });
    await prisma.product.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
  }
  await prisma.seller.deleteMany({ where: { id: { in: sellerIds } } });
}

/**
 * Seeds directly rather than through register + verify-otp, which would need an OTP
 * read off the service's stdout.
 */
async function seed(): Promise<Fixtures> {
  const hashedPassword = await hash(PASSWORD, BCRYPT_COST);

  const buyer = await prisma.user.create({
    data: {
      name: 'Cart Buyer',
      email: BUYER_EMAIL,
      password: hashedPassword,
      emailVerified: true,
    },
  });

  const shopIds: Record<string, string> = {};
  for (const { key, email, shop } of SELLERS) {
    const seller = await prisma.seller.create({
      data: {
        name: shop,
        email,
        password: hashedPassword,
        phoneNumber: '+6580000000',
        country: 'SG',
        emailVerified: true,
      },
    });
    const created = await prisma.shop.create({
      data: {
        name: shop,
        // Must be a member of CATEGORIES; this row bypasses zod.
        category: 'Home & Garden',
        address: '1 Test Street',
        sellerId: seller.id,
        status: 'APPROVED',
      },
    });
    shopIds[key] = created.id;
  }

  const suffix = Date.now().toString(36);
  const productIds: Record<string, string> = {};

  const seeds = [
    { key: 'plain', shop: 'A', price: 10, salePrice: null, stock: 20, status: 'ACTIVE' },
    { key: 'sale', shop: 'A', price: 40, salePrice: 25, stock: 20, status: 'ACTIVE' },
    { key: 'scarce', shop: 'A', price: 5, salePrice: null, stock: 3, status: 'ACTIVE' },
    { key: 'other', shop: 'B', price: 7.5, salePrice: null, stock: 20, status: 'ACTIVE' },
    { key: 'draft', shop: 'A', price: 9, salePrice: null, stock: 20, status: 'DRAFT' },
  ] as const;

  for (const s of seeds) {
    const product = await prisma.product.create({
      data: {
        title: `Cart ${s.key}`,
        slug: `cart-${s.key}-${suffix}`,
        description: 'Fixture for the cart verification suite.',
        category: 'Home & Garden',
        tags: [],
        price: s.price,
        salePrice: s.salePrice,
        stock: s.stock,
        status: s.status,
        shopId: shopIds[s.shop],
      },
    });
    productIds[s.key] = product.id;
  }

  const res = await request('post', '/auth/login', {
    body: { email: BUYER_EMAIL, password: PASSWORD },
  });
  if (res.status !== 200) {
    throw new Error(
      `Buyer login failed: ${res.status} ${JSON.stringify(res.data)}`
    );
  }
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) {
    throw new Error('Buyer login returned no cookies');
  }

  return {
    buyerId: buyer.id,
    cookie: setCookie.map((c: string) => c.split(';')[0]).join('; '),
    productIds,
    shopIds,
  };
}

// --- helpers --------------------------------------------------------------

type Cart = {
  shops: {
    shop: { id: string; name: string };
    items: {
      productId: string;
      title: string;
      price: number;
      originalPrice: number | null;
      quantity: number;
      stock: number;
      lineTotal: number;
    }[];
    subtotal: number;
  }[];
  total: number;
  itemCount: number;
  distinctItems: number;
  notices: { type: string; title: string; quantity?: number }[];
};

const getCart = (cookie: string) => request('get', '/order/cart', { cookie });

const addItem = (cookie: string, productId: string, quantity?: number) =>
  request('post', '/order/cart/items', {
    cookie,
    body: quantity === undefined ? { productId } : { productId, quantity },
  });

/** All lines across every shop group, flattened. */
function lines(cart: Cart) {
  return cart.shops.flatMap((g) => g.items);
}

function lineFor(cart: Cart, productId: string) {
  return lines(cart).find((i) => i.productId === productId);
}

// --- sections -------------------------------------------------------------

async function sectionAuth(f: Fixtures) {
  console.log('\n[1] Authentication');

  for (const [method, path] of [
    ['get', '/order/cart'],
    ['post', '/order/cart/items'],
    ['patch', `/order/cart/items/${f.productIds.plain}`],
    ['delete', `/order/cart/items/${f.productIds.plain}`],
    ['delete', '/order/cart'],
  ] as const) {
    const res = await request(method, path, { body: {} });
    check(
      `anonymous ${method.toUpperCase()} ${path.replace(/[0-9a-f]{24}/, ':id')} is 401`,
      res.status === 401,
      `got ${res.status}`
    );
  }

  const empty = await getCart(f.cookie);
  check('authenticated GET /order/cart is 200', empty.status === 200, `got ${empty.status}`);
  check(
    'a new buyer starts with an empty cart',
    empty.data.itemCount === 0 && empty.data.shops.length === 0,
    JSON.stringify(empty.data)
  );
}

async function sectionStorage(f: Fixtures) {
  console.log('\n[2] The storage guarantee — price is never cached');

  await addItem(f.cookie, f.productIds.plain, 2);

  const before = (await getCart(f.cookie)).data as Cart;
  check(
    'item added at its seeded price',
    lineFor(before, f.productIds.plain)?.price === 10,
    JSON.stringify(lineFor(before, f.productIds.plain))
  );

  // The heart of the suite: change the price behind the cart's back.
  await prisma.product.update({
    where: { id: f.productIds.plain },
    data: { price: 12.5 },
  });

  const after = (await getCart(f.cookie)).data as Cart;
  const line = lineFor(after, f.productIds.plain);
  check(
    'a price changed after adding is reflected on the next read',
    line?.price === 12.5,
    `got ${line?.price}`
  );
  check(
    'the line total is recomputed from the new price',
    line?.lineTotal === 25,
    `got ${line?.lineTotal}`
  );

  // And the direct proof: look at what Redis actually holds.
  const stored = await redis.hgetall(`cart:${f.buyerId}`);
  check(
    'Redis holds exactly one field per distinct product',
    Object.keys(stored).length === 1 &&
      stored[f.productIds.plain] !== undefined,
    JSON.stringify(stored)
  );
  check(
    'the stored value is a bare quantity, not a JSON object',
    stored[f.productIds.plain] === '2',
    JSON.stringify(stored)
  );

  const blob = JSON.stringify(stored).toLowerCase();
  for (const forbidden of ['price', 'title', 'image', 'slug', '10', '12.5']) {
    check(
      `no "${forbidden}" anywhere in the stored cart`,
      !blob.includes(forbidden),
      blob
    );
  }

  const ttl = await redis.ttl(`cart:${f.buyerId}`);
  check(
    'the key carries a ~30-day TTL',
    ttl > 29 * 24 * 3600 && ttl <= 30 * 24 * 3600,
    `got ${ttl}`
  );

  // Restore so later sections work from the seeded price.
  await prisma.product.update({
    where: { id: f.productIds.plain },
    data: { price: 10 },
  });
}

async function sectionSalePrice(f: Fixtures) {
  console.log('\n[3] Effective price');

  await addItem(f.cookie, f.productIds.sale, 2);
  const cart = (await getCart(f.cookie)).data as Cart;
  const line = lineFor(cart, f.productIds.sale);

  check('a sale product charges salePrice', line?.price === 25, `got ${line?.price}`);
  check(
    'the undiscounted price is reported alongside',
    line?.originalPrice === 40,
    `got ${line?.originalPrice}`
  );
  check('line total uses the sale price', line?.lineTotal === 50, `got ${line?.lineTotal}`);
}

async function sectionGrouping(f: Fixtures) {
  console.log('\n[4] Grouping by shop');

  await addItem(f.cookie, f.productIds.other, 2);
  const cart = (await getCart(f.cookie)).data as Cart;

  check('two shops produce two groups', cart.shops.length === 2, `got ${cart.shops.length}`);

  const groupA = cart.shops.find((g) => g.shop.id === f.shopIds.A);
  const groupB = cart.shops.find((g) => g.shop.id === f.shopIds.B);

  check('shop A group is present', Boolean(groupA));
  check('shop B group is present', Boolean(groupB));
  check(
    'a group carries the shop name but no seller internals',
    groupA !== undefined &&
      groupA.shop.name === 'Cart Shop A' &&
      Object.keys(groupA.shop).sort().join(',') === 'id,name',
    JSON.stringify(groupA?.shop)
  );

  // plain 2x10 + sale 2x25 = 70; other 2x7.5 = 15
  check('shop A subtotal', groupA?.subtotal === 70, `got ${groupA?.subtotal}`);
  check('shop B subtotal', groupB?.subtotal === 15, `got ${groupB?.subtotal}`);
  check(
    'total equals the sum of subtotals',
    cart.total === 85,
    `got ${cart.total}`
  );
  check('itemCount sums quantities', cart.itemCount === 6, `got ${cart.itemCount}`);
  check('distinctItems counts lines', cart.distinctItems === 3, `got ${cart.distinctItems}`);
}

async function sectionClamp(f: Fixtures) {
  console.log('\n[5] Stock clamping — reported, never persisted');

  // scarce has stock 3; ask for 10.
  await addItem(f.cookie, f.productIds.scarce, 10);

  const clamped = (await getCart(f.cookie)).data as Cart;
  const line = lineFor(clamped, f.productIds.scarce);

  check('quantity is clamped to stock', line?.quantity === 3, `got ${line?.quantity}`);
  check(
    'a clamp notice names the product and the new quantity',
    clamped.notices.some(
      (n) => n.type === 'clamped' && n.title === 'Cart scarce' && n.quantity === 3
    ),
    JSON.stringify(clamped.notices)
  );

  const stored = await redis.hget(`cart:${f.buyerId}`, f.productIds.scarce);
  check(
    'the clamp is NOT written back to Redis',
    stored === '10',
    `stored ${stored}, expected 10`
  );

  // Restock and the buyer gets their original quantity back, untouched.
  await prisma.product.update({
    where: { id: f.productIds.scarce },
    data: { stock: 20 },
  });

  const restocked = (await getCart(f.cookie)).data as Cart;
  check(
    'a restock restores the original quantity with no buyer action',
    lineFor(restocked, f.productIds.scarce)?.quantity === 10,
    `got ${lineFor(restocked, f.productIds.scarce)?.quantity}`
  );
  check(
    'and the clamp notice is gone',
    !restocked.notices.some((n) => n.title === 'Cart scarce'),
    JSON.stringify(restocked.notices)
  );

  // Out of stock entirely: reported, kept in storage, contributes nothing.
  await prisma.product.update({
    where: { id: f.productIds.scarce },
    data: { stock: 0 },
  });

  const oos = (await getCart(f.cookie)).data as Cart;
  check(
    'an out-of-stock item drops out of the lines',
    lineFor(oos, f.productIds.scarce) === undefined
  );
  check(
    'and is reported as out of stock',
    oos.notices.some(
      (n) => n.type === 'clamped' && n.title === 'Cart scarce' && n.quantity === 0
    ),
    JSON.stringify(oos.notices)
  );
  check(
    'but is still counted as a distinct item',
    oos.distinctItems === 4,
    `got ${oos.distinctItems}`
  );
  check(
    'and is still in Redis, waiting on a restock',
    (await redis.hget(`cart:${f.buyerId}`, f.productIds.scarce)) === '10'
  );

  await prisma.product.update({
    where: { id: f.productIds.scarce },
    data: { stock: 20 },
  });
}

async function sectionPrune(f: Fixtures) {
  console.log('\n[6] Pruning — withdrawn products heal out of the cart');

  // A product that goes DRAFT after it was added.
  await prisma.product.update({
    where: { id: f.productIds.plain },
    data: { status: 'DRAFT' },
  });

  const first = (await getCart(f.cookie)).data as Cart;
  check(
    'a de-listed product is gone from the lines',
    lineFor(first, f.productIds.plain) === undefined
  );
  check(
    'and is reported once, by name',
    first.notices.some(
      (n) => n.type === 'removed' && n.title === 'Cart plain'
    ),
    JSON.stringify(first.notices)
  );
  check(
    'the Redis field is deleted by the read',
    (await redis.hget(`cart:${f.buyerId}`, f.productIds.plain)) === null
  );

  const second = (await getCart(f.cookie)).data as Cart;
  check(
    'a second read no longer reports it — the prune stuck',
    !second.notices.some((n) => n.title === 'Cart plain'),
    JSON.stringify(second.notices)
  );

  // A whole shop losing approval takes its products with it.
  await prisma.shop.update({
    where: { id: f.shopIds.B },
    data: { status: 'PENDING' },
  });

  const afterShop = (await getCart(f.cookie)).data as Cart;
  check(
    'a product whose shop is no longer APPROVED is removed',
    lineFor(afterShop, f.productIds.other) === undefined
  );
  check(
    'and its shop group disappears entirely',
    !afterShop.shops.some((g) => g.shop.id === f.shopIds.B),
    JSON.stringify(afterShop.shops.map((g) => g.shop))
  );

  // Restore for the sections that follow.
  await prisma.product.update({
    where: { id: f.productIds.plain },
    data: { status: 'ACTIVE' },
  });
  await prisma.shop.update({
    where: { id: f.shopIds.B },
    data: { status: 'APPROVED' },
  });
}

async function sectionValidation(f: Fixtures) {
  console.log('\n[7] Validation');

  const bad: [string, unknown, number][] = [
    ['quantity 0', { productId: f.productIds.plain, quantity: 0 }, 400],
    ['quantity 100', { productId: f.productIds.plain, quantity: 100 }, 400],
    ['quantity 2.5', { productId: f.productIds.plain, quantity: 2.5 }, 400],
    ['quantity as a string', { productId: f.productIds.plain, quantity: '2' }, 400],
    ['malformed productId', { productId: 'not-an-id', quantity: 1 }, 400],
    ['missing productId', { quantity: 1 }, 400],
    ['an unknown field', { productId: f.productIds.plain, quantity: 1, price: 0.01 }, 400],
  ];

  for (const [label, body, expected] of bad) {
    const res = await request('post', '/order/cart/items', { cookie: f.cookie, body });
    check(`POST rejects ${label}`, res.status === expected, `got ${res.status}`);
  }

  // A price a client tries to smuggle in is refused outright, not ignored.
  check(
    'a smuggled price is a 400, not silently dropped',
    (
      await request('post', '/order/cart/items', {
        cookie: f.cookie,
        body: { productId: f.productIds.plain, quantity: 1, price: 0.01 },
      })
    ).status === 400
  );

  const draft = await addItem(f.cookie, f.productIds.draft, 1);
  check('a DRAFT product cannot be added (404)', draft.status === 404, `got ${draft.status}`);

  const absent = await addItem(f.cookie, '0'.repeat(24), 1);
  check(
    'a well-formed but unknown id is the same 404',
    absent.status === 404,
    `got ${absent.status}`
  );
  check(
    'both answer with the same message — nothing confirms a DRAFT exists',
    draft.data?.message === absent.data?.message,
    `${draft.data?.message} vs ${absent.data?.message}`
  );

  const patchBad = await request('patch', `/order/cart/items/${f.productIds.sale}`, {
    cookie: f.cookie,
    body: { quantity: 0 },
  });
  check('PATCH rejects quantity 0', patchBad.status === 400, `got ${patchBad.status}`);

  const patchAbsent = await request('patch', `/order/cart/items/${'0'.repeat(24)}`, {
    cookie: f.cookie,
    body: { quantity: 1 },
  });
  check(
    'PATCH on an item not in the cart is 404',
    patchAbsent.status === 404,
    `got ${patchAbsent.status}`
  );

  const deleteAbsent = await request('delete', `/order/cart/items/${'0'.repeat(24)}`, {
    cookie: f.cookie,
  });
  check(
    'DELETE on an item not in the cart is 404',
    deleteAbsent.status === 404,
    `got ${deleteAbsent.status}`
  );
}

async function sectionMutations(f: Fixtures) {
  console.log('\n[8] Add, update, remove');

  await request('delete', '/order/cart', { cookie: f.cookie });

  const added = await addItem(f.cookie, f.productIds.plain, 2);
  check('POST answers with the whole cart', added.data.itemCount === 2, JSON.stringify(added.data));

  // Adding again accumulates rather than replacing.
  const again = await addItem(f.cookie, f.productIds.plain, 3);
  check(
    'adding the same product accumulates',
    (again.data as Cart).itemCount === 5,
    `got ${(again.data as Cart).itemCount}`
  );

  // stock is 20, so the 99 cap is what bites here rather than stock.
  await prisma.product.update({
    where: { id: f.productIds.plain },
    data: { stock: 200 },
  });
  const saturated = await addItem(f.cookie, f.productIds.plain, 99);
  check(
    'accumulating past 99 saturates rather than erroring',
    (saturated.data as Cart).itemCount === 99,
    `got ${(saturated.data as Cart).itemCount}`
  );

  const patched = await request('patch', `/order/cart/items/${f.productIds.plain}`, {
    cookie: f.cookie,
    body: { quantity: 4 },
  });
  check(
    'PATCH sets the quantity absolutely',
    (patched.data as Cart).itemCount === 4,
    `got ${(patched.data as Cart).itemCount}`
  );

  const omitted = await addItem(f.cookie, f.productIds.sale);
  check(
    'quantity defaults to 1 when omitted',
    lineFor(omitted.data as Cart, f.productIds.sale)?.quantity === 1
  );

  const removed = await request('delete', `/order/cart/items/${f.productIds.plain}`, {
    cookie: f.cookie,
  });
  check(
    'DELETE removes just that line',
    lineFor(removed.data as Cart, f.productIds.plain) === undefined &&
      lineFor(removed.data as Cart, f.productIds.sale) !== undefined
  );

  const cleared = await request('delete', '/order/cart', { cookie: f.cookie });
  check('DELETE /cart empties it', (cleared.data as Cart).itemCount === 0);
  check(
    'and the Redis key is gone entirely',
    (await redis.exists(`cart:${f.buyerId}`)) === 0
  );

  await prisma.product.update({
    where: { id: f.productIds.plain },
    data: { stock: 20 },
  });
}

async function sectionIsolation(f: Fixtures) {
  console.log('\n[9] Isolation and persistence');

  await addItem(f.cookie, f.productIds.plain, 2);

  // A second login is a different session but the same cart — the key is the user id,
  // so nothing about the cart lives in the cookie.
  const res = await request('post', '/auth/login', {
    body: { email: BUYER_EMAIL, password: PASSWORD },
  });
  const fresh = (res.headers['set-cookie'] as string[])
    .map((c) => c.split(';')[0])
    .join('; ');

  const reloaded = (await getCart(fresh)).data as Cart;
  check(
    'the cart survives logging out and back in',
    lineFor(reloaded, f.productIds.plain)?.quantity === 2,
    JSON.stringify(reloaded)
  );

  // A seller's token must not open a buyer's cart: isAuthenticated looks the id up
  // in User, and a seller id is not there.
  const sellerLogin = await request('post', '/seller/login', {
    body: { email: SELLERS[0].email, password: PASSWORD },
  });
  if (sellerLogin.status === 200) {
    const sellerCookie = (sellerLogin.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const asSeller = await getCart(sellerCookie);
    check(
      "a seller's session cannot read a buyer's cart",
      asSeller.status === 401,
      `got ${asSeller.status}`
    );
  } else {
    check('seller login for the cross-role check', false, `got ${sellerLogin.status}`);
  }
}

async function sectionCap(f: Fixtures) {
  console.log('\n[10] The 50-distinct-item cap');

  await request('delete', '/order/cart', { cookie: f.cookie });

  // 50 throwaway products, filled straight into Redis: going through the API would be
  // 50 round trips to prove an off-by-one.
  const suffix = Date.now().toString(36);
  const filler: string[] = [];
  for (let i = 0; i < 50; i++) {
    const p = await prisma.product.create({
      data: {
        title: `Cart filler ${i}`,
        slug: `cart-filler-${i}-${suffix}`,
        description: 'Fixture.',
        category: 'Home & Garden',
        tags: [],
        price: 1,
        stock: 5,
        status: 'ACTIVE',
        shopId: f.shopIds.A,
      },
    });
    filler.push(p.id);
  }

  await redis.hset(
    `cart:${f.buyerId}`,
    ...filler.flatMap((id) => [id, '1'])
  );

  check(
    'the cart now holds 50 distinct products',
    (await redis.hlen(`cart:${f.buyerId}`)) === 50
  );

  const fiftyFirst = await addItem(f.cookie, f.productIds.plain, 1);
  check(
    'a 51st distinct product is rejected',
    fiftyFirst.status === 400,
    `got ${fiftyFirst.status}`
  );

  // But an item already in the cart stays addable at the cap.
  const existing = await addItem(f.cookie, filler[0], 1);
  check(
    'an item already in the cart is still addable at the cap',
    existing.status === 200,
    `got ${existing.status}`
  );

  await request('delete', '/order/cart', { cookie: f.cookie });
  await prisma.product.deleteMany({ where: { id: { in: filler } } });
}

// --- main -----------------------------------------------------------------

async function main() {
  console.log('Verifying the cart against', GATEWAY);

  await cleanup();
  const fixtures = await seed();

  try {
    await sectionAuth(fixtures);
    await sectionStorage(fixtures);
    await sectionSalePrice(fixtures);
    await sectionGrouping(fixtures);
    await sectionClamp(fixtures);
    await sectionPrune(fixtures);
    await sectionValidation(fixtures);
    await sectionMutations(fixtures);
    await sectionIsolation(fixtures);
    await sectionCap(fixtures);
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\nSuite aborted:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
