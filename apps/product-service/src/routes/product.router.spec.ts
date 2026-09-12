import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Guards are stubbed to pass through: this file is about which handler a path
// reaches, not about auth. The guards themselves are covered elsewhere.
jest.mock('@openshelf/middleware', () => ({
  isSellerAuthenticated: (
    _req: unknown,
    _res: unknown,
    next: () => void
  ) => next(),
  requireApprovedShop: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Every handler answers with its own name, so the response body identifies
// which route matched. Built inside the factory because jest.mock is hoisted
// above anything declared at module scope.
jest.mock('../controllers/product.controller.js', () => {
  const named =
    (name: string) => (req: express.Request, res: express.Response) => {
      res.status(200).json({ handler: name, params: req.params });
    };

  return {
    createProduct: named('createProduct'),
    listMyProducts: named('listMyProducts'),
    getUploadAuth: named('getUploadAuth'),
    getProduct: named('getProduct'),
    updateProduct: named('updateProduct'),
    deleteProduct: named('deleteProduct'),
    getPublicProductBySlug: named('getPublicProductBySlug'),
    listPublicProducts: named('listPublicProducts'),
    addProductImage: named('addProductImage'),
    deleteProductImage: named('deleteProductImage'),
  };
});

import { productRouter } from './product.router.js';

const PRODUCT_ID = '111111111111111111111111';
const IMAGE_ID = '222222222222222222222222';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/product', productRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function hit(method: string, path: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  return res.json() as Promise<{ handler: string; params: Record<string, string> }>;
}

describe('route ordering', () => {
  // '/:id' is registered too and would happily match the literal string
  // 'upload-auth' as an id. Registration order is the only thing stopping it,
  // and both routes sit behind the same guards, so a mis-ordering would not
  // show up as an auth difference — only as the wrong handler running.
  it('GET /upload-auth reaches getUploadAuth, not getProduct', async () => {
    await expect(hit('GET', '/product/upload-auth')).resolves.toMatchObject({
      handler: 'getUploadAuth',
    });
  });

  it('GET /mine reaches listMyProducts', async () => {
    await expect(hit('GET', '/product/mine')).resolves.toMatchObject({
      handler: 'listMyProducts',
    });
  });

  // The storefront's catalogue is anonymous. '/:id' sits behind the seller
  // guards, so a mis-ordering here would not merely route wrongly — it would
  // answer 401 to every buyer.
  it('GET /public reaches listPublicProducts, not getProduct', async () => {
    await expect(hit('GET', '/product/public')).resolves.toMatchObject({
      handler: 'listPublicProducts',
    });
  });

  it('GET /public/:slug reaches getPublicProductBySlug', async () => {
    await expect(hit('GET', '/product/public/some-slug')).resolves.toMatchObject(
      { handler: 'getPublicProductBySlug', params: { slug: 'some-slug' } }
    );
  });

  it('GET /:id still reaches getProduct', async () => {
    await expect(hit('GET', `/product/${PRODUCT_ID}`)).resolves.toMatchObject({
      handler: 'getProduct',
      params: { id: PRODUCT_ID },
    });
  });
});

describe('image routes', () => {
  it('POST /:id/images reaches addProductImage', async () => {
    await expect(
      hit('POST', `/product/${PRODUCT_ID}/images`)
    ).resolves.toMatchObject({
      handler: 'addProductImage',
      params: { id: PRODUCT_ID },
    });
  });

  it('DELETE /:id/images/:imageId reaches deleteProductImage', async () => {
    await expect(
      hit('DELETE', `/product/${PRODUCT_ID}/images/${IMAGE_ID}`)
    ).resolves.toMatchObject({
      handler: 'deleteProductImage',
      params: { id: PRODUCT_ID, imageId: IMAGE_ID },
    });
  });

  it('DELETE /:id is not shadowed by the image route', async () => {
    await expect(
      hit('DELETE', `/product/${PRODUCT_ID}`)
    ).resolves.toMatchObject({ handler: 'deleteProduct' });
  });
});
