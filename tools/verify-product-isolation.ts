import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import axios, { AxiosError, AxiosResponse } from 'axios';

/**
 * End-to-end proof that a seller cannot reach another shop's products.
 *
 * Runs through Node directly (not Nx/webpack), so per CLAUDE.md it imports only
 * npm packages — no @openshelf/* libs.
 *
 * Prerequisites: MongoDB Atlas unpaused, Redis reachable, and the gateway,
 * seller-service and product-service all serving.
 *
 *   node -r @swc-node/register tools/verify-product-isolation.ts
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';
const BCRYPT_COST = 12;
const PASSWORD = 'password123';

const SELLERS = [
  { key: 'A', email: 'isolation-a@openshelf.test', shop: 'Isolation Shop A' },
  { key: 'B', email: 'isolation-b@openshelf.test', shop: 'Isolation Shop B' },
] as const;

const prisma = new PrismaClient();

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
        `${axiosErr.message}. Are the gateway, seller-service and ` +
        `product-service all running?`
    );
  }
}

async function cleanup() {
  const emails = SELLERS.map((s) => s.email);
  const sellers = await prisma.seller.findMany({
    where: { email: { in: [...emails] } },
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
    // Image rows first: they point at products, and Mongo has no cascade.
    const products = await prisma.product.findMany({
      where: { shopId: { in: shopIds } },
      select: { id: true },
    });
    await prisma.image.deleteMany({
      where: { productId: { in: products.map((p) => p.id) } },
    });
    await prisma.product.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
  }
  await prisma.seller.deleteMany({ where: { id: { in: sellerIds } } });

  // Anything this run put in ImageKit, whether or not a handler removed it.
  // Skipped silently when the account is not configured.
  if (process.env.IMAGEKIT_PRIVATE_KEY) {
    for (const fileId of uploadedFileIds) {
      await ikDelete(fileId);
    }
  }
}

/**
 * Seeds sellers directly rather than going through register + verify-otp,
 * which would need an OTP read off the service's stdout.
 */
async function seed() {
  const hashedPassword = await hash(PASSWORD, BCRYPT_COST);

  for (const { email, shop } of SELLERS) {
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
    await prisma.shop.create({
      data: {
        name: shop,
        category: 'Homeware',
        address: '1 Test Street',
        sellerId: seller.id,
        status: 'APPROVED',
      },
    });
  }
}

async function login(email: string): Promise<string> {
  const res = await request('post', '/seller/login', {
    body: { email, password: PASSWORD },
  });
  if (res.status !== 200) {
    throw new Error(
      `Login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`
    );
  }
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) {
    throw new Error(`Login for ${email} returned no cookies`);
  }
  return setCookie.map((c: string) => c.split(';')[0]).join('; ');
}

// --- ImageKit helpers -----------------------------------------------------

/**
 * Talks to ImageKit over REST rather than through @openshelf/imagekit: this
 * script runs under plain Node, which per CLAUDE.md cannot resolve @openshelf/*
 * libs. Using the raw API also keeps the check honest — it exercises the same
 * surface the service does, without sharing code with it.
 */
const IK_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const IK_API_URL = 'https://api.imagekit.io/v1/files';
const VERIFY_FOLDER = '/openshelf-verify';

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** Every file this script puts in ImageKit, so cleanup can take them all back out. */
const uploadedFileIds: string[] = [];

function ikAuthHeader(): string {
  const key = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!key) {
    throw new Error('IMAGEKIT_PRIVATE_KEY is not set');
  }
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

async function ikUpload(
  fileName: string,
  bytes: Buffer
): Promise<{ fileId: string; url: string }> {
  const form = new FormData();
  // Copied into a Uint8Array backed by a plain ArrayBuffer: a Node Buffer is
  // not a valid BlobPart, since its backing store may be a SharedArrayBuffer.
  form.append('file', new Blob([new Uint8Array(bytes)]), fileName);
  form.append('fileName', fileName);
  form.append('folder', VERIFY_FOLDER);

  const res = await axios.post(IK_UPLOAD_URL, form, {
    headers: { Authorization: ikAuthHeader() },
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  if (res.status !== 200) {
    throw new Error(
      `ImageKit upload of ${fileName} failed: ${res.status} ${JSON.stringify(res.data)}`
    );
  }

  uploadedFileIds.push(res.data.fileId);
  return { fileId: res.data.fileId, url: res.data.url };
}

/** True when the file is still in the media library. */
async function ikExists(fileId: string): Promise<boolean> {
  const res = await axios.get(`${IK_API_URL}/${fileId}/details`, {
    headers: { Authorization: ikAuthHeader() },
    validateStatus: () => true,
  });
  return res.status === 200;
}

async function ikDelete(fileId: string): Promise<void> {
  await axios.delete(`${IK_API_URL}/${fileId}`, {
    headers: { Authorization: ikAuthHeader() },
    validateStatus: () => true,
  });
}

async function imageRowCount(productId: string): Promise<number> {
  return prisma.image.count({ where: { productId } });
}

/** Creates a product through the API and returns its id. */
async function createFixture(cookie: string, title: string): Promise<string> {
  const res = await request('post', '/product', {
    cookie,
    body: {
      title,
      description: 'Fixture for the ImageKit checks.',
      category: 'Homeware',
      price: 10,
      stock: 1,
    },
  });
  if (res.status !== 201) {
    throw new Error(
      `Could not create fixture ${title}: ${res.status} ${JSON.stringify(res.data)}`
    );
  }
  return res.data.id;
}

/**
 * The image half of the suite. Split out because it needs live ImageKit
 * credentials, which the isolation checks above do not.
 */
async function verifyImages(cookieA: string, cookieB: string): Promise<void> {
  // Fresh products of its own: this section soft-deletes one at the end,
  // which would collide with the soft-delete checks that run after it.
  const productAId = await createFixture(cookieA, 'Image Fixture A');
  const productBId = await createFixture(cookieB, 'Image Fixture B');

  console.log('\nImageKit — upload auth');

  const auth = await request('get', '/product/upload-auth', { cookie: cookieA });
  check('GET /product/upload-auth -> 200', auth.status === 200, `got ${auth.status}`);
  check(
    'returns exactly token, expire, signature',
    auth.status === 200 &&
      JSON.stringify(Object.keys(auth.data).sort()) ===
        JSON.stringify(['expire', 'signature', 'token']),
    `got ${JSON.stringify(Object.keys(auth.data ?? {}))}`
  );

  // The single most important assertion in this file.
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY as string;
  check(
    'the private key appears nowhere in the response',
    !JSON.stringify(auth.data).includes(privateKey) &&
      !JSON.stringify(auth.headers).includes(privateKey)
  );

  const noAuth = await request('get', '/product/upload-auth');
  check('upload-auth without a session -> 401/403', [401, 403].includes(noAuth.status), `got ${noAuth.status}`);

  console.log('\nImageKit — attaching');

  const uploaded = await ikUpload('verify-a.png', TINY_PNG);

  const attach = await request('post', `/product/${productAId}/images`, {
    cookie: cookieA,
    body: uploaded,
  });
  check('seller A attaches their own upload -> 201', attach.status === 201, `got ${attach.status} ${JSON.stringify(attach.data)}`);
  check('the stored url is the ImageKit url', attach.data?.url === uploaded.url, `got ${attach.data?.url}`);
  // getFileDetails returns this url with a ?updatedAt cache-buster appended;
  // what is persisted must be the bare form so ?tr=... can be appended to it.
  check('the stored url carries no query string', !String(attach.data?.url ?? '').includes('?'), `got ${attach.data?.url}`);

  const imageId: string = attach.data?.id;

  // Cross-shop: seller B holds a genuine fileId, but not A's product.
  const crossShop = await request('post', `/product/${productAId}/images`, {
    cookie: cookieB,
    body: uploaded,
  });
  check('seller B attaching to A’s product -> 404 (not 403)', crossShop.status === 404, `got ${crossShop.status}`);
  check('and no row was created for it', (await imageRowCount(productAId)) === 1, 'row count changed');

  // ImageKit answers these two differently -- a malformed id is a 400
  // ("invalid fileId parameter"), a well-formed one naming nothing is a 404
  // ("The requested file does not exist.") -- and both have to read as a
  // rejected forgery rather than an upstream failure.
  const malformed = await request('post', `/product/${productAId}/images`, {
    cookie: cookieA,
    body: { fileId: 'forgedfileid0000000000', url: uploaded.url },
  });
  check('a malformed fileId (ImageKit 400) -> 400', malformed.status === 400, `got ${malformed.status}`);
  check('  and not a 500', malformed.status !== 500, `got ${malformed.status}`);

  const absent = await request('post', `/product/${productAId}/images`, {
    cookie: cookieA,
    body: { fileId: '000000000000000000000000', url: uploaded.url },
  });
  check('a well-formed but unknown fileId (ImageKit 404) -> 400', absent.status === 400, `got ${absent.status}`);
  check('  and not a 500', absent.status !== 500, `got ${absent.status}`);

  check('neither forgery landed in the Image collection', (await imageRowCount(productAId)) === 1, 'row count changed');

  const wrongUrl = await request('post', `/product/${productAId}/images`, {
    cookie: cookieA,
    body: { fileId: uploaded.fileId, url: 'https://evil.example.com/x.png' },
  });
  check('a real fileId with a foreign url -> 400', wrongUrl.status === 400, `got ${wrongUrl.status}`);

  console.log('\nImageKit — size cap');

  // Not an image, deliberately: the cap is about bytes, and the server only
  // ever learns the size from ImageKit because the file never passes through it.
  const big = await ikUpload('verify-oversized.bin', Buffer.alloc(6 * 1024 * 1024, 7));
  const oversized = await request('post', `/product/${productAId}/images`, {
    cookie: cookieA,
    body: big,
  });
  check('a >5MB file -> 400', oversized.status === 400, `got ${oversized.status}`);
  check('the oversized file is left on ImageKit for a retry', await ikExists(big.fileId));

  console.log('\nImageKit — 8-image cap');

  // One already attached; add seven more to reach the cap.
  for (let i = 0; i < 7; i++) {
    const extra = await ikUpload(`verify-cap-${i}.png`, TINY_PNG);
    const res = await request('post', `/product/${productAId}/images`, {
      cookie: cookieA,
      body: extra,
    });
    if (res.status !== 201) {
      check(`filling the cap: image ${i + 2} -> 201`, false, `got ${res.status}`);
    }
  }
  check('8 images attached', (await imageRowCount(productAId)) === 8, `got ${await imageRowCount(productAId)}`);

  const ninth = await ikUpload('verify-ninth.png', TINY_PNG);
  const overCap = await request('post', `/product/${productAId}/images`, {
    cookie: cookieA,
    body: ninth,
  });
  check('a 9th image -> 400', overCap.status === 400, `got ${overCap.status}`);
  check('still exactly 8 rows', (await imageRowCount(productAId)) === 8, `got ${await imageRowCount(productAId)}`);

  // The cap is per product, not per shop.
  const forB = await ikUpload('verify-b.png', TINY_PNG);
  const attachB = await request('post', `/product/${productBId}/images`, {
    cookie: cookieB,
    body: forB,
  });
  check('seller B can still attach to their own product', attachB.status === 201, `got ${attachB.status}`);

  console.log('\nImageKit — deleting');

  const crossDelete = await request('delete', `/product/${productAId}/images/${imageId}`, {
    cookie: cookieB,
  });
  check('seller B deleting A’s image -> 404', crossDelete.status === 404, `got ${crossDelete.status}`);
  check('the file survives that attempt', await ikExists(uploaded.fileId));

  const del = await request('delete', `/product/${productAId}/images/${imageId}`, {
    cookie: cookieA,
  });
  check('seller A deletes their image -> 200', del.status === 200, `got ${del.status}`);
  check('the file is gone from ImageKit', !(await ikExists(uploaded.fileId)));
  check('the row is gone too', (await imageRowCount(productAId)) === 7, `got ${await imageRowCount(productAId)}`);

  console.log('\nImageKit — cleanup on soft delete');

  const remaining = await prisma.image.findMany({ where: { productId: productAId } });
  const softDelete = await request('delete', `/product/${productAId}`, { cookie: cookieA });
  check('DELETE the product -> 200', softDelete.status === 200, `got ${softDelete.status}`);
  check(
    `all ${remaining.length} images reported deleted`,
    softDelete.data?.imagesDeleted === remaining.length,
    `got ${JSON.stringify(softDelete.data)}`
  );
  check('no Image rows left', (await imageRowCount(productAId)) === 0, `got ${await imageRowCount(productAId)}`);

  let stillRemote = 0;
  for (const image of remaining) {
    if (await ikExists(image.fileId)) stillRemote++;
  }
  check('no ImageKit files left', stillRemote === 0, `${stillRemote} still present`);

  // B's product was never touched by any of it.
  check("seller B's image is untouched", (await imageRowCount(productBId)) === 1);
  check("seller B's file is untouched", await ikExists(forB.fileId));
}

async function main() {
  console.log(`Gateway: ${GATEWAY}\n`);

  await cleanup();
  await seed();

  const cookieA = await login(SELLERS[0].email);
  const cookieB = await login(SELLERS[1].email);
  console.log('Logged in as both sellers.\n');

  // --- each seller creates a product -------------------------------------
  const createA = await request('post', '/product', {
    cookie: cookieA,
    body: {
      title: 'Isolation Mug A',
      description: "Seller A's product.",
      category: 'Homeware',
      tags: ['a'],
      price: 20,
      salePrice: 15,
      stock: 3,
    },
  });
  const createB = await request('post', '/product', {
    cookie: cookieB,
    body: {
      title: 'Isolation Bowl B',
      description: "Seller B's product.",
      category: 'Homeware',
      price: 30,
      stock: 1,
    },
  });

  console.log('Setup');
  check('seller A creates a product (201)', createA.status === 201, `got ${createA.status} ${JSON.stringify(createA.data)}`);
  check('seller B creates a product (201)', createB.status === 201, `got ${createB.status} ${JSON.stringify(createB.data)}`);

  if (createA.status !== 201 || createB.status !== 201) {
    throw new Error('Could not create the fixture products; aborting.');
  }

  const productA = createA.data;
  const productB = createB.data;

  check(
    'shopId comes from the session, not the request',
    productA.shopId !== productB.shopId
  );
  check('slug generated server-side', productA.slug === 'isolation-mug-a', `got ${productA.slug}`);
  check('status defaults to ACTIVE', productA.status === 'ACTIVE', `got ${productA.status}`);

  // --- the isolation check -----------------------------------------------
  // 404, not 403: a 403 would confirm B's id exists.
  console.log('\nCross-shop isolation (seller A against seller B\'s product id)');

  const getForeign = await request('get', `/product/${productB.id}`, { cookie: cookieA });
  check('GET    -> 404', getForeign.status === 404, `got ${getForeign.status}`);
  check('GET    -> not 403', getForeign.status !== 403);

  const patchForeign = await request('patch', `/product/${productB.id}`, {
    cookie: cookieA,
    body: { title: 'Hijacked by A' },
  });
  check('PATCH  -> 404', patchForeign.status === 404, `got ${patchForeign.status}`);
  check('PATCH  -> not 403', patchForeign.status !== 403);

  const deleteForeign = await request('delete', `/product/${productB.id}`, {
    cookie: cookieA,
  });
  check('DELETE -> 404', deleteForeign.status === 404, `got ${deleteForeign.status}`);
  check('DELETE -> not 403', deleteForeign.status !== 403);

  const bAfter = await prisma.product.findUnique({ where: { id: productB.id } });
  check("seller B's product is untouched", bAfter?.title === 'Isolation Bowl B' && bAfter?.status === 'ACTIVE');

  // --- listing is scoped --------------------------------------------------
  console.log('\nScoping');
  const mineA = await request('get', '/product/mine?page=1&limit=20', { cookie: cookieA });
  const idsA = (mineA.data.products ?? []).map((p: { id: string }) => p.id);
  check('GET /product/mine returns only A\'s products', mineA.status === 200 && idsA.length === 1 && idsA[0] === productA.id, `got ${JSON.stringify(idsA)}`);
  check('pagination envelope present', mineA.data.total === 1 && mineA.data.page === 1 && mineA.data.totalPages === 1);

  // --- rejected input -----------------------------------------------------
  console.log('\nRejected input');
  const withShopId = await request('post', '/product', {
    cookie: cookieA,
    body: {
      title: 'Injected',
      description: 'Carries a shopId.',
      category: 'Homeware',
      price: 10,
      shopId: productB.shopId,
    },
  });
  check('body containing shopId -> 400', withShopId.status === 400, `got ${withShopId.status}`);

  const withSlug = await request('post', '/product', {
    cookie: cookieA,
    body: { title: 'Slug Squatter', description: 'x', category: 'Homeware', price: 10, slug: 'mine' },
  });
  check('client-supplied slug -> 400', withSlug.status === 400, `got ${withSlug.status}`);

  const badSale = await request('post', '/product', {
    cookie: cookieA,
    body: { title: 'Bad Sale', description: 'x', category: 'Homeware', price: 10, salePrice: 15 },
  });
  check('salePrice >= price -> 400', badSale.status === 400, `got ${badSale.status}`);

  const tooManyTags = await request('post', '/product', {
    cookie: cookieA,
    body: {
      title: 'Stuffed',
      description: 'x',
      category: 'Homeware',
      price: 10,
      tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
    },
  });
  check('21 tags -> 400', tooManyTags.status === 400, `got ${tooManyTags.status}`);

  const noAuth = await request('get', '/product/mine');
  check('GET /product/mine without a session -> 401', noAuth.status === 401, `got ${noAuth.status}`);

  // --- public endpoint ----------------------------------------------------
  console.log('\nPublic endpoint (no auth)');
  const publicOk = await request('get', `/product/public/${productA.slug}`);
  check('ACTIVE product from an approved shop -> 200', publicOk.status === 200, `got ${publicOk.status}`);
  check('trimmed shop payload, no seller internals', publicOk.status === 200 && publicOk.data.shop?.id !== undefined && publicOk.data.shop?.sellerId === undefined);

  await request('patch', `/product/${productA.id}`, {
    cookie: cookieA,
    body: { status: 'DRAFT' },
  });
  const publicDraft = await request('get', `/product/public/${productA.slug}`);
  check('DRAFT product -> 404', publicDraft.status === 404, `got ${publicDraft.status}`);

  await request('patch', `/product/${productA.id}`, {
    cookie: cookieA,
    body: { status: 'ACTIVE' },
  });

  // Neither non-approved state may expose the product, and they are separate
  // rows in this table only because ShopStatus replaced the isApproved boolean.
  await prisma.shop.update({
    where: { id: productA.shopId },
    data: { status: 'PENDING' },
  });
  const publicPending = await request('get', `/product/public/${productA.slug}`);
  check('product from a PENDING shop -> 404', publicPending.status === 404, `got ${publicPending.status}`);

  await prisma.shop.update({
    where: { id: productA.shopId },
    data: { status: 'REJECTED', rejectionReason: 'Incomplete address' },
  });
  const publicRejected = await request('get', `/product/public/${productA.slug}`);
  check('product from a REJECTED shop -> 404', publicRejected.status === 404, `got ${publicRejected.status}`);

  await prisma.shop.update({
    where: { id: productA.shopId },
    data: { status: 'APPROVED', rejectionReason: null },
  });

  // --- images -------------------------------------------------------------
  // Needs live ImageKit credentials; the checks above do not, so a workspace
  // without them still gets the isolation suite rather than a hard failure.
  if (process.env.IMAGEKIT_PRIVATE_KEY) {
    await verifyImages(cookieA, cookieB);
  } else {
    console.log('\nImageKit: skipped (IMAGEKIT_PRIVATE_KEY not set)');
  }

  // --- soft delete --------------------------------------------------------
  console.log('\nSoft delete');
  const del = await request('delete', `/product/${productA.id}`, { cookie: cookieA });
  check('DELETE own product -> 200', del.status === 200, `got ${del.status}`);

  const row = await prisma.product.findUnique({ where: { id: productA.id } });
  check('row still exists in Mongo', row !== null);
  check('status is DELETED', row?.status === 'DELETED', `got ${row?.status}`);

  const getDeleted = await request('get', `/product/${productA.id}`, { cookie: cookieA });
  check('GET a deleted product -> 404', getDeleted.status === 404, `got ${getDeleted.status}`);

  const publicDeleted = await request('get', `/product/public/${productA.slug}`);
  check('public GET of a deleted product -> 404', publicDeleted.status === 404, `got ${publicDeleted.status}`);

  const deleteAgain = await request('delete', `/product/${productA.id}`, { cookie: cookieA });
  check('second DELETE -> 404', deleteAgain.status === 404, `got ${deleteAgain.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error('\n', err instanceof Error ? err.message : err);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log('Seeded data cleaned up.');
    process.exit(failed > 0 ? 1 : 0);
  });
