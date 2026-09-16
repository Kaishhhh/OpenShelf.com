import type { Request, Response } from 'express';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@openshelf/errors';
import { Prisma, type ShopStatus } from '@prisma/client';

const SHOP_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PRODUCT_A = '111111111111111111111111';
const PRODUCT_B = '222222222222222222222222';

type ProductStatus = 'ACTIVE' | 'DRAFT' | 'DELETED';

interface FakeProduct {
  id: string;
  shopId: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  price: number;
  salePrice: number | null;
  stock: number;
  status: ProductStatus;
}

interface FakeShop {
  id: string;
  name: string;
  category: string;
  avatar: string | null;
  ratings: number;
  status: ShopStatus;
  // Deliberately carries stripeId: the fake returns the whole row regardless of
  // `select`, so a handler that spread `shop.seller` would leak it in a test.
  seller: { stripeChargesEnabled: boolean; stripeId: string | null };
}

interface WhereClause {
  id?: string;
  shopId?: string;
  slug?: string;
  status?: ProductStatus | { not: ProductStatus };
}

interface PrismaArgs {
  where: WhereClause;
  data?: Partial<FakeProduct>;
  include?: { shop?: unknown; images?: unknown };
  skip?: number;
  take?: number;
  orderBy?: unknown;
}

interface CreateArgs {
  data: Omit<FakeProduct, 'id' | 'salePrice' | 'status'> &
    Partial<Pick<FakeProduct, 'salePrice' | 'status'>>;
}

function makeProduct(over: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id: PRODUCT_A,
    shopId: SHOP_A,
    title: 'Mug',
    slug: 'mug',
    description: 'A mug',
    category: 'Home & Garden',
    price: 20,
    salePrice: null,
    stock: 5,
    status: 'ACTIVE',
    ...over,
  };
}

// Both shops' products live in one table, exactly as they do in Mongo. The
// fake applies the handler's own `where` to that table, so a handler that
// forgot shopId would genuinely return the other shop's row here.
let table: FakeProduct[] = [];
const calls: { method: string; args: PrismaArgs }[] = [];

function matches(row: FakeProduct, where: WhereClause | undefined): boolean {
  if (!where) return true;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.shopId !== undefined && row.shopId !== where.shopId) return false;
  if (where.slug !== undefined && row.slug !== where.slug) return false;
  if (where.status !== undefined) {
    if (typeof where.status === 'string') {
      if (row.status !== where.status) return false;
    } else if (row.status === where.status.not) {
      return false;
    }
  }
  return true;
}

const shops: Record<string, FakeShop> = {
  [SHOP_A]: {
    id: SHOP_A,
    name: 'Shop A',
    category: 'Home & Garden',
    avatar: null,
    ratings: 4.5,
    status: 'APPROVED',
    seller: { stripeChargesEnabled: true, stripeId: 'acct_secret_a' },
  },
  [SHOP_B]: {
    id: SHOP_B,
    name: 'Shop B',
    category: 'Home & Garden',
    avatar: null,
    ratings: 4.0,
    status: 'APPROVED',
    seller: { stripeChargesEnabled: true, stripeId: 'acct_secret_b' },
  },
};

let createImpl: (args: CreateArgs) => Promise<FakeProduct>;

// --- images ---------------------------------------------------------------

const IMAGE_A = 'aaaa1111aaaa1111aaaa1111';
// Valid ObjectId shape on purpose: a malformed one 404s in parseObjectId
// before the scoping checks these tests exist to exercise.
const IMAGE_B = 'bbbb2222bbbb2222bbbb2222';
const FILE_A = 'file_a';

interface FakeImage {
  id: string;
  fileId: string;
  url: string;
  productId: string;
}

interface ImageWhere {
  id?: string;
  productId?: string;
}

interface ImageArgs {
  where?: ImageWhere;
  data?: Omit<FakeImage, 'id'>;
}

/** Images for both shops' products live in one table, as they do in Mongo. */
let images: FakeImage[] = [];
const imageCalls: { method: string; args: ImageArgs }[] = [];

function imageMatches(row: FakeImage, where: ImageWhere | undefined): boolean {
  if (!where) return true;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.productId !== undefined && row.productId !== where.productId)
    return false;
  return true;
}

// --- imagekit -------------------------------------------------------------

const PRIVATE_KEY = 'private_key_must_never_be_returned';
const CDN = 'https://ik.imagekit.io/openshelf';

interface FakeFile {
  fileId: string;
  type: 'file' | 'file-version';
  url: string;
  size: number;
}

/** Stands in for the account's media library. */
let remoteFiles: Record<string, FakeFile> = {};
let deleteFileImpl: (fileId: string) => Promise<void>;
const imagekitCalls: { method: string; fileId?: string }[] = [];

jest.mock('@openshelf/imagekit', () => ({
  canonicalFileUrl: (raw: string) => {
    try {
      const u = new URL(raw);
      return `${u.origin}${u.pathname}`;
    } catch {
      return null;
    }
  },
  getUploadAuth: () => {
    imagekitCalls.push({ method: 'getUploadAuth' });
    return {
      publicKey: 'public_abc',
      token: 'tok-1',
      expire: 1893456000,
      signature: 'sig-1',
    };
  },
  getFileById: (fileId: string) => {
    imagekitCalls.push({ method: 'getFileById', fileId });
    const file = remoteFiles[fileId];
    if (!file) return Promise.resolve(null);
    // getFileDetails appends a cache-buster the upload response does not have;
    // returning the identical string here would hide the real mismatch.
    return Promise.resolve({ ...file, url: `${file.url}?updatedAt=1788184520647` });
  },
  deleteFile: (fileId: string) => {
    imagekitCalls.push({ method: 'deleteFile', fileId });
    return deleteFileImpl(fileId);
  },
}));

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    image: {
      create: (args: ImageArgs) => {
        imageCalls.push({ method: 'create', args });
        const row = { id: `img-${images.length + 1}`, ...args.data } as FakeImage;
        images.push(row);
        return Promise.resolve(row);
      },
      count: (args: ImageArgs) => {
        imageCalls.push({ method: 'count', args });
        return Promise.resolve(
          images.filter((r) => imageMatches(r, args.where)).length
        );
      },
      findFirst: (args: ImageArgs) => {
        imageCalls.push({ method: 'findFirst', args });
        return Promise.resolve(
          images.find((r) => imageMatches(r, args.where)) ?? null
        );
      },
      findMany: (args: ImageArgs) => {
        imageCalls.push({ method: 'findMany', args });
        return Promise.resolve(images.filter((r) => imageMatches(r, args.where)));
      },
      delete: (args: ImageArgs) => {
        imageCalls.push({ method: 'delete', args });
        const idx = images.findIndex((r) => imageMatches(r, args.where));
        const [row] = images.splice(idx, 1);
        return Promise.resolve(row);
      },
    },
    shop: {
      findFirst: (args: { where: { id: string; status: ShopStatus } }) => {
        const shop = shops[args.where.id];
        return Promise.resolve(
          shop && shop.status === args.where.status ? shop : null
        );
      },
    },
    product: {
      create: (args: CreateArgs) => {
        calls.push({ method: 'create', args: args as unknown as PrismaArgs });
        return createImpl(args);
      },
      findFirst: (args: PrismaArgs) => {
        calls.push({ method: 'findFirst', args });
        const row = table.find((r) => matches(r, args.where)) ?? null;
        if (row && args.include?.shop) {
          return Promise.resolve({ ...row, shop: shops[row.shopId] });
        }
        return Promise.resolve(row);
      },
      findMany: (args: PrismaArgs) => {
        calls.push({ method: 'findMany', args });
        const rows = table.filter((r) => matches(r, args.where));
        return Promise.resolve(
          args.include?.shop
            ? rows.map((r) => ({ ...r, shop: shops[r.shopId] }))
            : rows
        );
      },
      count: (args: PrismaArgs) => {
        calls.push({ method: 'count', args });
        return Promise.resolve(
          table.filter((r) => matches(r, args.where)).length
        );
      },
      updateMany: (args: PrismaArgs) => {
        calls.push({ method: 'updateMany', args });
        const hits = table.filter((r) => matches(r, args.where));
        hits.forEach((r) => Object.assign(r, args.data));
        return Promise.resolve({ count: hits.length });
      },
    },
  },
}));

import {
  addProductImage,
  createProduct,
  deleteProduct,
  deleteProductImage,
  getProduct,
  getPublicProductBySlug,
  getPublicShop,
  getUploadAuth,
  listMyProducts,
  listPublicProducts,
  updateProduct,
} from './product.controller.js';

interface MockRes extends Response {
  statusCode: number;
  body: Record<string, never> & Record<string, unknown>;
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

interface ReqOverrides {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

function mockReq(over: ReqOverrides = {}, shopId: string | null = SHOP_A) {
  return {
    params: {},
    query: {},
    body: {},
    ...(shopId ? { shop: { id: shopId } } : {}),
    ...over,
  } as unknown as Request;
}

const validBody = {
  title: 'Ceramic Mug',
  description: 'A hand-thrown stoneware mug.',
  category: 'Home & Garden',
  price: 24.5,
};

beforeEach(() => {
  table = [
    makeProduct(),
    makeProduct({ id: PRODUCT_B, shopId: SHOP_B, title: 'Bowl', slug: 'bowl' }),
  ];
  calls.length = 0;
  shops[SHOP_A].status = 'APPROVED';
  shops[SHOP_B].status = 'APPROVED';
  shops[SHOP_A].seller.stripeChargesEnabled = true;
  shops[SHOP_B].seller.stripeChargesEnabled = true;

  images = [
    { id: IMAGE_A, fileId: FILE_A, url: `${CDN}/a.jpg`, productId: PRODUCT_A },
  ];
  imageCalls.length = 0;
  imagekitCalls.length = 0;
  remoteFiles = {
    [FILE_A]: {
      fileId: FILE_A,
      type: 'file',
      url: `${CDN}/a.jpg`,
      size: 120_000,
    },
    file_new: {
      fileId: 'file_new',
      type: 'file',
      url: `${CDN}/new.jpg`,
      size: 250_000,
    },
  };
  deleteFileImpl = (fileId: string) => {
    delete remoteFiles[fileId];
    return Promise.resolve();
  };

  createImpl = (args: CreateArgs) => {
    const row = makeProduct({ ...args.data, id: 'new-id' });
    table.push(row);
    return Promise.resolve(row);
  };
});

/** Every prisma call the handler made must have carried the caller's shopId. */
function expectEveryCallScopedTo(shopId: string) {
  const scoped = calls.filter((c) => c.method !== 'create');
  expect(scoped.length).toBeGreaterThan(0);
  for (const call of scoped) {
    expect(call.args.where.shopId).toBe(shopId);
  }
}

describe('cross-shop isolation', () => {
  // Seller A asks for seller B's product id. It must look exactly like an id
  // that does not exist — 404, not 403, so the response never confirms it does.
  it("getProduct returns 404 (not 403) for another shop's product", async () => {
    const req = mockReq({ params: { id: PRODUCT_B } });
    await expect(getProduct(req, mockRes())).rejects.toBeInstanceOf(
      NotFoundError
    );
    expectEveryCallScopedTo(SHOP_A);
  });

  it("updateProduct returns 404 (not 403) for another shop's product", async () => {
    const req = mockReq({
      params: { id: PRODUCT_B },
      body: { title: 'Hijacked' },
    });
    await expect(updateProduct(req, mockRes())).rejects.toBeInstanceOf(
      NotFoundError
    );
    expectEveryCallScopedTo(SHOP_A);
    // and B's product is untouched
    expect(table.find((r) => r.id === PRODUCT_B)?.title).toBe('Bowl');
  });

  it("deleteProduct returns 404 (not 403) for another shop's product", async () => {
    const req = mockReq({ params: { id: PRODUCT_B } });
    await expect(deleteProduct(req, mockRes())).rejects.toBeInstanceOf(
      NotFoundError
    );
    expectEveryCallScopedTo(SHOP_A);
    expect(table.find((r) => r.id === PRODUCT_B)?.status).toBe('ACTIVE');
  });

  it("listMyProducts returns only the caller's products", async () => {
    const res = mockRes();
    await listMyProducts(mockReq(), res);
    expect(res.body.products).toHaveLength(1);
    expect((res.body.products as FakeProduct[])[0].id).toBe(PRODUCT_A);
    expectEveryCallScopedTo(SHOP_A);
  });

  it('a malformed id 404s rather than reaching prisma', async () => {
    const req = mockReq({ params: { id: 'not-an-object-id' } });
    await expect(getProduct(req, mockRes())).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(calls).toHaveLength(0);
  });
});

describe('createProduct', () => {
  it('takes shopId from req.shop, never the body', async () => {
    const res = mockRes();
    await createProduct(mockReq({ body: { ...validBody } }), res);
    expect(res.statusCode).toBe(201);
    const created = calls.find((c) => c.method === 'create');
    expect(created?.args.data?.shopId).toBe(SHOP_A);
  });

  it('rejects a body containing shopId', async () => {
    const req = mockReq({ body: { ...validBody, shopId: SHOP_B } });
    await expect(createProduct(req, mockRes())).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(calls).toHaveLength(0);
  });

  it('rejects a client-supplied slug or status', async () => {
    await expect(
      createProduct(mockReq({ body: { ...validBody, slug: 'mine' } }), mockRes())
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createProduct(
        mockReq({ body: { ...validBody, status: 'DRAFT' } }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('generates the slug from the title', async () => {
    await createProduct(
      mockReq({ body: { ...validBody, title: 'Crème Brûlée Dish!' } }),
      mockRes()
    );
    const created = calls.find((c) => c.method === 'create');
    expect(created?.args.data?.slug).toBe('creme-brulee-dish');
  });

  it('retries with a random suffix when the slug collides', async () => {
    let attempts = 0;
    createImpl = (args: CreateArgs) => {
      attempts++;
      if (attempts === 1) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: '6.19.0',
            meta: { target: ['slug'] },
          })
        );
      }
      return Promise.resolve(makeProduct({ ...args.data, id: 'new-id' }));
    };

    const res = mockRes();
    await createProduct(mockReq({ body: { ...validBody } }), res);

    expect(attempts).toBe(2);
    const slugs = calls
      .filter((c) => c.method === 'create')
      .map((c) => c.args.data?.slug);
    expect(slugs[0]).toBe('ceramic-mug');
    expect(slugs[1]).toMatch(/^ceramic-mug-[a-z0-9]{1,6}$/);
    expect(res.statusCode).toBe(201);
  });
});

describe('updateProduct', () => {
  it("updates the caller's own product", async () => {
    const res = mockRes();
    await updateProduct(
      mockReq({ params: { id: PRODUCT_A }, body: { title: 'New Mug' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(table.find((r) => r.id === PRODUCT_A)?.title).toBe('New Mug');
  });

  it('leaves the slug unchanged when the title changes', async () => {
    await updateProduct(
      mockReq({ params: { id: PRODUCT_A }, body: { title: 'New Mug' } }),
      mockRes()
    );
    expect(table.find((r) => r.id === PRODUCT_A)?.slug).toBe('mug');
  });

  // A PATCH carrying only salePrice must still be checked against the stored
  // price, which the schema alone can't see.
  it('rejects a salePrice that is not below the stored price', async () => {
    const req = mockReq({
      params: { id: PRODUCT_A },
      body: { salePrice: 25 },
    });
    await expect(updateProduct(req, mockRes())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('accepts a salePrice below the stored price', async () => {
    const res = mockRes();
    await updateProduct(
      mockReq({ params: { id: PRODUCT_A }, body: { salePrice: 15 } }),
      res
    );
    expect(res.statusCode).toBe(200);
  });

  it('cannot resurrect a soft-deleted product', async () => {
    table[0].status = 'DELETED';
    const req = mockReq({
      params: { id: PRODUCT_A },
      body: { status: 'ACTIVE' },
    });
    await expect(updateProduct(req, mockRes())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('deleteProduct', () => {
  it('soft deletes — status becomes DELETED and the row survives', async () => {
    const res = mockRes();
    await deleteProduct(mockReq({ params: { id: PRODUCT_A } }), res);
    expect(res.statusCode).toBe(200);
    const row = table.find((r) => r.id === PRODUCT_A);
    expect(row).toBeDefined();
    expect(row?.status).toBe('DELETED');
  });

  it('404s on a second delete', async () => {
    await deleteProduct(mockReq({ params: { id: PRODUCT_A } }), mockRes());
    await expect(
      deleteProduct(mockReq({ params: { id: PRODUCT_A } }), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getPublicProductBySlug', () => {
  it('returns an ACTIVE product from an approved shop', async () => {
    const res = mockRes();
    await getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(PRODUCT_A);
    expect(res.body.shop).toEqual({
      id: SHOP_A,
      name: 'Shop A',
      avatar: null,
      ratings: 4.5,
    });
  });

  it('does not leak a DRAFT product', async () => {
    table[0].status = 'DRAFT';
    await expect(
      getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not leak a DELETED product', async () => {
    table[0].status = 'DELETED';
    await expect(
      getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not leak a product from a shop still pending review', async () => {
    shops[SHOP_A].status = 'PENDING';
    await expect(
      getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // Distinct from PENDING: before ShopStatus existed both were isApproved
  // false, so this case could not be expressed separately.
  it('does not leak a product from a rejected shop', async () => {
    shops[SHOP_A].status = 'REJECTED';
    await expect(
      getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s on an unknown slug', async () => {
    await expect(
      getPublicProductBySlug(mockReq({ params: { slug: 'nope' } }, null), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is purchasable when the seller can receive funds', async () => {
    const res = mockRes();
    await getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), res);
    expect(res.body.purchasable).toBe(true);
  });

  // Listed but not buyable: still a 200, never a 404.
  it('is still returned, unpurchasable, when the seller cannot receive funds', async () => {
    shops[SHOP_A].seller.stripeChargesEnabled = false;
    const res = mockRes();
    await getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.purchasable).toBe(false);
  });

  it('never exposes seller fields', async () => {
    const res = mockRes();
    await getPublicProductBySlug(mockReq({ params: { slug: 'mug' } }, null), res);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('seller');
    expect(json).not.toContain('acct_secret');
  });
});

describe('listPublicProducts', () => {
  it('derives purchasable per product from its own seller', async () => {
    shops[SHOP_B].seller.stripeChargesEnabled = false;
    const res = mockRes();
    await listPublicProducts(mockReq({}, null), res);

    const products = res.body.products as {
      id: string;
      purchasable: boolean;
    }[];
    // The unpurchasable product is still listed.
    expect(products.map((p) => [p.id, p.purchasable])).toEqual([
      [PRODUCT_A, true],
      [PRODUCT_B, false],
    ]);
  });

  it('projects the shop card and never exposes seller fields', async () => {
    const res = mockRes();
    await listPublicProducts(mockReq({}, null), res);

    const products = res.body.products as { shop: unknown }[];
    expect(products[0].shop).toEqual({
      id: SHOP_A,
      name: 'Shop A',
      category: 'Home & Garden',
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('seller');
    expect(json).not.toContain('acct_secret');
  });
});

describe('getPublicShop', () => {
  it('marks the shop and its products unpurchasable when charges are disabled', async () => {
    shops[SHOP_A].seller.stripeChargesEnabled = false;
    const res = mockRes();
    await getPublicShop(mockReq({ params: { id: SHOP_A } }, null), res);

    expect(res.statusCode).toBe(200);
    expect((res.body.shop as { purchasable: boolean }).purchasable).toBe(false);
    const products = res.body.products as { id: string; purchasable: boolean }[];
    expect(products).toEqual([
      expect.objectContaining({ id: PRODUCT_A, purchasable: false }),
    ]);
  });

  it('never exposes seller fields', async () => {
    const res = mockRes();
    await getPublicShop(mockReq({ params: { id: SHOP_A } }, null), res);
    expect((res.body.shop as { purchasable: boolean }).purchasable).toBe(true);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('seller');
    expect(json).not.toContain('acct_secret');
  });
});

describe('getUploadAuth', () => {
  it('returns exactly publicKey, token, expire and signature', async () => {
    const res = mockRes();
    await getUploadAuth(mockReq(), res);
    expect(res.statusCode).toBe(200);
    // publicKey is here on purpose — a browser cannot POST to ImageKit without
    // it. The private-key assertion below is the one guarding the secret.
    expect(Object.keys(res.body).sort()).toEqual([
      'expire',
      'publicKey',
      'signature',
      'token',
    ]);
  });

  it('refuses to mint params without an approved shop', async () => {
    await expect(
      getUploadAuth(mockReq({}, null), mockRes())
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(imagekitCalls).toHaveLength(0);
  });

  it('never puts the private key in the response', async () => {
    const res = mockRes();
    await getUploadAuth(mockReq(), res);
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_KEY);
    expect(JSON.stringify(res.body)).not.toContain('privateKey');
  });
});

describe('addProductImage', () => {
  const body = { fileId: 'file_new', url: `${CDN}/new.jpg` };

  it('attaches an image to a product the caller owns', async () => {
    const res = mockRes();
    await addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), res);
    expect(res.statusCode).toBe(201);
    expect(images).toHaveLength(2);
    expect(images[1]).toMatchObject({
      fileId: 'file_new',
      url: `${CDN}/new.jpg`,
      productId: PRODUCT_A,
    });
  });

  it('404s for another shop product, without calling ImageKit at all', async () => {
    await expect(
      addProductImage(mockReq({ params: { id: PRODUCT_B }, body }), mockRes())
    ).rejects.toBeInstanceOf(NotFoundError);
    expectEveryCallScopedTo(SHOP_A);
    expect(imagekitCalls).toHaveLength(0);
    expect(images).toHaveLength(1);
  });

  it('rejects a forged fileId', async () => {
    await expect(
      addProductImage(
        mockReq({
          params: { id: PRODUCT_A },
          body: { fileId: 'file_forged', url: `${CDN}/new.jpg` },
        }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
  });

  it('rejects a fileId resolving to a file version rather than a file', async () => {
    remoteFiles['file_new'].type = 'file-version';
    await expect(
      addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), mockRes())
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
  });

  it('rejects a url that does not match the uploaded file', async () => {
    await expect(
      addProductImage(
        mockReq({
          params: { id: PRODUCT_A },
          body: { fileId: 'file_new', url: 'https://evil.example.com/x.jpg' },
        }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
  });

  it('stores the ImageKit url, never a string the client supplied', async () => {
    await addProductImage(
      mockReq({ params: { id: PRODUCT_A }, body }),
      mockRes()
    );
    expect(images[1].url).toBe(remoteFiles['file_new'].url);
  });

  it('rejects a file over 5MB and leaves it on ImageKit for a retry', async () => {
    remoteFiles['file_new'].size = 5 * 1024 * 1024 + 1;
    await expect(
      addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), mockRes())
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
    expect(imagekitCalls.some((c) => c.method === 'deleteFile')).toBe(false);
    expect(remoteFiles['file_new']).toBeDefined();
  });

  it('accepts a file sitting exactly on the 5MB cap', async () => {
    remoteFiles['file_new'].size = 5 * 1024 * 1024;
    const res = mockRes();
    await addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), res);
    expect(res.statusCode).toBe(201);
  });

  it('holds the 8-image cap', async () => {
    images = Array.from({ length: 8 }, (_, i) => ({
      id: `img-${i}`,
      fileId: `file_${i}`,
      url: `${CDN}/${i}.jpg`,
      productId: PRODUCT_A,
    }));

    await expect(
      addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), mockRes())
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(images).toHaveLength(8);
    // Cheap check first: no ImageKit round-trip once the cap is known to be hit.
    expect(imagekitCalls).toHaveLength(0);
  });

  it('counts only the target product images toward the cap', async () => {
    images = Array.from({ length: 8 }, (_, i) => ({
      id: `img-${i}`,
      fileId: `file_${i}`,
      url: `${CDN}/${i}.jpg`,
      productId: PRODUCT_B,
    }));

    const res = mockRes();
    await addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), res);
    expect(res.statusCode).toBe(201);
  });

  it('rejects a fileId carrying path separators before it reaches ImageKit', async () => {
    await expect(
      addProductImage(
        mockReq({
          params: { id: PRODUCT_A },
          body: { fileId: '../../files/x', url: `${CDN}/new.jpg` },
        }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(imagekitCalls).toHaveLength(0);
  });
});

describe('deleteProductImage', () => {
  it('removes the remote file and then the row', async () => {
    const res = mockRes();
    await deleteProductImage(
      mockReq({ params: { id: PRODUCT_A, imageId: IMAGE_A } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(remoteFiles[FILE_A]).toBeUndefined();
    expect(images).toHaveLength(0);

    // Order is the whole point: remote first, row second.
    expect(imagekitCalls[0]).toEqual({ method: 'deleteFile', fileId: FILE_A });
    expect(imageCalls.at(-1)?.method).toBe('delete');
  });

  it('keeps the row when ImageKit refuses to delete', async () => {
    deleteFileImpl = () => Promise.reject(new Error('ImageKit 500'));
    await expect(
      deleteProductImage(
        mockReq({ params: { id: PRODUCT_A, imageId: IMAGE_A } }),
        mockRes()
      )
    ).rejects.toThrow('ImageKit 500');
    // An orphaned row is retryable; an orphaned remote file is not.
    expect(images).toHaveLength(1);
  });

  it('404s for another shop product without touching ImageKit', async () => {
    images.push({
      id: IMAGE_B,
      fileId: 'file_b',
      url: `${CDN}/b.jpg`,
      productId: PRODUCT_B,
    });
    await expect(
      deleteProductImage(
        mockReq({ params: { id: PRODUCT_B, imageId: IMAGE_B } }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(NotFoundError);
    expectEveryCallScopedTo(SHOP_A);
    expect(imagekitCalls).toHaveLength(0);
    expect(images).toHaveLength(2);
  });

  it('404s for an image id belonging to a different product', async () => {
    images.push({
      id: IMAGE_B,
      fileId: 'file_b',
      url: `${CDN}/b.jpg`,
      productId: PRODUCT_B,
    });
    await expect(
      deleteProductImage(
        mockReq({ params: { id: PRODUCT_A, imageId: IMAGE_B } }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(images).toHaveLength(2);
  });
});

describe('deleteProduct image cleanup', () => {
  beforeEach(() => {
    images.push({
      id: 'img-2',
      fileId: 'file_2',
      url: `${CDN}/2.jpg`,
      productId: PRODUCT_A,
    });
    remoteFiles['file_2'] = {
      fileId: 'file_2',
      type: 'file',
      url: `${CDN}/2.jpg`,
      size: 90_000,
    };
  });

  it('destroys the remote files and their rows', async () => {
    const res = mockRes();
    await deleteProduct(mockReq({ params: { id: PRODUCT_A } }), res);

    expect(res.body).toMatchObject({ status: 'DELETED', imagesDeleted: 2 });
    expect(images).toHaveLength(0);
    expect(remoteFiles[FILE_A]).toBeUndefined();
    expect(remoteFiles['file_2']).toBeUndefined();
  });

  it('soft-deletes the product before touching ImageKit', async () => {
    await deleteProduct(mockReq({ params: { id: PRODUCT_A } }), mockRes());
    // A cleanup failure must never cost a live product its pictures, so the
    // status change has to be committed first.
    expect(calls.findIndex((c) => c.method === 'updateMany')).toBe(0);
    expect(imagekitCalls.length).toBeGreaterThan(0);
  });

  it('keeps the row for a file ImageKit would not delete, and still 200s', async () => {
    deleteFileImpl = (fileId: string) => {
      if (fileId === FILE_A) return Promise.reject(new Error('ImageKit 500'));
      delete remoteFiles[fileId];
      return Promise.resolve();
    };

    const res = mockRes();
    await deleteProduct(mockReq({ params: { id: PRODUCT_A } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ imagesDeleted: 1, imagesFailed: 1 });
    // The failure did not block the other file...
    expect(remoteFiles['file_2']).toBeUndefined();
    // ...and the fileId that failed is still recorded so it can be retried.
    expect(images).toEqual([expect.objectContaining({ fileId: FILE_A })]);
    expect(table.find((r) => r.id === PRODUCT_A)?.status).toBe('DELETED');
  });

  it('leaves another shop images alone', async () => {
    images.push({
      id: IMAGE_B,
      fileId: 'file_b',
      url: `${CDN}/b.jpg`,
      productId: PRODUCT_B,
    });
    await deleteProduct(mockReq({ params: { id: PRODUCT_A } }), mockRes());
    expect(images).toEqual([expect.objectContaining({ productId: PRODUCT_B })]);
  });
});

// Regression cover for the two live-API mismatches that unit tests with an
// over-idealised fake had missed.
describe('addProductImage against real ImageKit response shapes', () => {
  const body = { fileId: 'file_new', url: `${CDN}/new.jpg` };

  it('accepts the bare upload url even though getFileDetails adds ?updatedAt', async () => {
    const res = mockRes();
    await addProductImage(mockReq({ params: { id: PRODUCT_A }, body }), res);
    expect(res.statusCode).toBe(201);
  });

  it('persists the url without the cache-buster, so ?tr= can be appended', async () => {
    await addProductImage(
      mockReq({ params: { id: PRODUCT_A }, body }),
      mockRes()
    );
    const stored = images[1].url;
    expect(stored).toBe(`${CDN}/new.jpg`);
    expect(stored).not.toContain('updatedAt');
    expect(stored).not.toContain('?');
  });

  it('still rejects a foreign host despite the normalisation', async () => {
    await expect(
      addProductImage(
        mockReq({
          params: { id: PRODUCT_A },
          body: { fileId: 'file_new', url: 'https://evil.example.com/new.jpg' },
        }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
  });

  it('still rejects a different path on the right host', async () => {
    await expect(
      addProductImage(
        mockReq({
          params: { id: PRODUCT_A },
          body: { fileId: 'file_new', url: `${CDN}/somethingelse.jpg` },
        }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
  });

  it('still rejects another ImageKit account on the same host', async () => {
    await expect(
      addProductImage(
        mockReq({
          params: { id: PRODUCT_A },
          body: {
            fileId: 'file_new',
            url: 'https://ik.imagekit.io/someoneelse/new.jpg',
          },
        }),
        mockRes()
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(images).toHaveLength(1);
  });

  // A client cannot smuggle a redirect or tracker in via the query, because
  // the query is dropped on both sides before comparison and never persisted.
  it('ignores a query the client appends, rather than storing it', async () => {
    const res = mockRes();
    await addProductImage(
      mockReq({
        params: { id: PRODUCT_A },
        body: { fileId: 'file_new', url: `${CDN}/new.jpg?tr=e-bgremove` },
      }),
      res
    );
    expect(res.statusCode).toBe(201);
    expect(images[1].url).toBe(`${CDN}/new.jpg`);
  });
});
