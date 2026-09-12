import {
  productCreateSchema,
  productImageCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
} from './product.schemas.js';

const validProduct = {
  title: 'Ceramic Mug',
  description: 'A hand-thrown stoneware mug.',
  category: 'Home & Garden',
  tags: ['ceramic', 'mug'],
  price: 24.5,
  salePrice: 19.99,
  stock: 12,
};

describe('productCreateSchema', () => {
  it('accepts a valid product', () => {
    const result = productCreateSchema.safeParse(validProduct);
    expect(result.success).toBe(true);
  });

  // Shares CATEGORIES with shops; free text here let spellings multiply.
  it.each(['Homeware', 'electronics', 'Electronis', '', 'Nope'])(
    'rejects the category %p',
    (category) => {
      const result = productCreateSchema.safeParse({
        ...validProduct,
        category,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['category']);
      }
    }
  );

  it('defaults tags to [] and stock to 0', () => {
    const result = productCreateSchema.parse({
      title: validProduct.title,
      description: validProduct.description,
      category: validProduct.category,
      price: validProduct.price,
    });
    expect(result.tags).toEqual([]);
    expect(result.stock).toBe(0);
  });

  // The core of the tenancy rule: shopId is server-supplied, so a body
  // carrying it must be rejected outright rather than silently ignored.
  it('rejects a body containing shopId', () => {
    const result = productCreateSchema.safeParse({
      ...validProduct,
      shopId: 'someone-elses-shop',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a client-supplied slug', () => {
    const result = productCreateSchema.safeParse({
      ...validProduct,
      slug: 'my-own-slug',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a client-supplied status', () => {
    const result = productCreateSchema.safeParse({
      ...validProduct,
      status: 'DRAFT',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a title longer than 200 characters', () => {
    const result = productCreateSchema.safeParse({
      ...validProduct,
      title: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a description longer than 5000 characters', () => {
    const result = productCreateSchema.safeParse({
      ...validProduct,
      description: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 20 tags but rejects 21', () => {
    const tag = (n: number) => `tag${n}`;
    expect(
      productCreateSchema.safeParse({
        ...validProduct,
        tags: Array.from({ length: 20 }, (_, i) => tag(i)),
      }).success
    ).toBe(true);
    expect(
      productCreateSchema.safeParse({
        ...validProduct,
        tags: Array.from({ length: 21 }, (_, i) => tag(i)),
      }).success
    ).toBe(false);
  });

  it('accepts a 30-character tag but rejects a 31-character one', () => {
    expect(
      productCreateSchema.safeParse({
        ...validProduct,
        tags: ['a'.repeat(30)],
      }).success
    ).toBe(true);
    expect(
      productCreateSchema.safeParse({
        ...validProduct,
        tags: ['a'.repeat(31)],
      }).success
    ).toBe(false);
  });

  it('rejects salePrice equal to or greater than price', () => {
    expect(
      productCreateSchema.safeParse({
        ...validProduct,
        price: 20,
        salePrice: 20,
      }).success
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({
        ...validProduct,
        price: 20,
        salePrice: 25,
      }).success
    ).toBe(false);
  });

  it('rejects a non-positive price', () => {
    expect(
      productCreateSchema.safeParse({ ...validProduct, price: 0, salePrice: undefined })
        .success
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({ ...validProduct, price: -1, salePrice: undefined })
        .success
    ).toBe(false);
  });

  it('rejects negative or fractional stock', () => {
    expect(
      productCreateSchema.safeParse({ ...validProduct, stock: -1 }).success
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({ ...validProduct, stock: 1.5 }).success
    ).toBe(false);
  });
});

describe('productUpdateSchema', () => {
  it('accepts a partial update', () => {
    const result = productUpdateSchema.safeParse({ title: 'New Title' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a body containing shopId', () => {
    expect(
      productUpdateSchema.safeParse({ title: 'x', shopId: 'other-shop' }).success
    ).toBe(false);
  });

  it('rejects a slug — slug is immutable after create', () => {
    expect(
      productUpdateSchema.safeParse({ slug: 'new-slug' }).success
    ).toBe(false);
  });

  it('allows toggling between ACTIVE and DRAFT', () => {
    expect(productUpdateSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
    expect(productUpdateSchema.safeParse({ status: 'DRAFT' }).success).toBe(true);
  });

  // Soft delete has exactly one path: DELETE /product/:id.
  it('rejects status DELETED', () => {
    expect(productUpdateSchema.safeParse({ status: 'DELETED' }).success).toBe(
      false
    );
  });

  it('allows clearing salePrice with null', () => {
    expect(productUpdateSchema.safeParse({ salePrice: null }).success).toBe(true);
  });

  it('rejects salePrice >= price when both are present', () => {
    expect(
      productUpdateSchema.safeParse({ price: 10, salePrice: 10 }).success
    ).toBe(false);
  });

  it('accepts salePrice alone — the merged check happens in the controller', () => {
    expect(productUpdateSchema.safeParse({ salePrice: 5 }).success).toBe(true);
  });
});

describe('productListQuerySchema', () => {
  it('defaults to page 1 and limit 20', () => {
    expect(productListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces string query params', () => {
    expect(productListQuerySchema.parse({ page: '3', limit: '50' })).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it('rejects page 0 and a limit above 100', () => {
    expect(productListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('productImageCreateSchema', () => {
  const valid = {
    fileId: 'abc123_XY-Z',
    url: 'https://ik.imagekit.io/openshelf/mug.jpg',
  };

  it('accepts a fileId and url pair', () => {
    expect(productImageCreateSchema.parse(valid)).toEqual(valid);
  });

  it('trims surrounding whitespace', () => {
    expect(
      productImageCreateSchema.parse({
        fileId: '  abc123  ',
        url: '  https://ik.imagekit.io/openshelf/mug.jpg  ',
      })
    ).toEqual({
      fileId: 'abc123',
      url: 'https://ik.imagekit.io/openshelf/mug.jpg',
    });
  });

  // fileId is interpolated into the ImageKit management API path, so anything
  // that could steer that path has to be rejected before it gets there.
  it.each([
    ['a path traversal', '../../files/other'],
    ['a slash', 'abc/def'],
    ['a query string', 'abc?tr=x'],
    ['a full url', 'https://evil.example.com/x'],
    ['an empty string', ''],
  ])('rejects a fileId containing %s', (_label, fileId) => {
    expect(
      productImageCreateSchema.safeParse({ ...valid, fileId }).success
    ).toBe(false);
  });

  it('rejects a fileId longer than 128 characters', () => {
    expect(
      productImageCreateSchema.safeParse({ ...valid, fileId: 'a'.repeat(129) })
        .success
    ).toBe(false);
  });

  it('rejects a url that is not a url', () => {
    expect(
      productImageCreateSchema.safeParse({ ...valid, url: 'not-a-url' }).success
    ).toBe(false);
  });

  it('rejects unknown fields, so nothing rides along into the row', () => {
    expect(
      productImageCreateSchema.safeParse({ ...valid, productId: 'x' }).success
    ).toBe(false);
    expect(
      productImageCreateSchema.safeParse({ ...valid, size: 1 }).success
    ).toBe(false);
  });

  it('requires both fields', () => {
    expect(
      productImageCreateSchema.safeParse({ fileId: 'abc123' }).success
    ).toBe(false);
    expect(productImageCreateSchema.safeParse({ url: valid.url }).success).toBe(
      false
    );
  });
});
