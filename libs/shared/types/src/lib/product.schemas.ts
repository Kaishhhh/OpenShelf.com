import { z } from 'zod';
import { CATEGORIES } from './categories';
import { optionalText } from './field-helpers';

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

// Kept as a bare shape so create can be `.strict()` and update can be
// `.partial().strict()` off the same field definitions.
const productBaseShape = {
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(200, 'Title is too long'),
  description: z
    .string()
    .trim()
    .min(1, 'Description is required')
    .max(5000, 'Description is too long'),
  // Shares one vocabulary with shops — see categories.ts. Free text here would
  // let 'Electronics', 'electronics' and 'Electronis' become three categories.
  category: z.enum(CATEGORIES, { message: 'Select a category' }),
  // Still free text, but blank means absent rather than an empty string, so an
  // untouched form input does not persist ''.
  subCategory: optionalText(100, 'Sub-category is too long'),
  // Bounded now rather than later: unbounded tags are a keyword-stuffing
  // vector the moment search exists.
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Tag cannot be empty')
        .max(
          MAX_TAG_LENGTH,
          `Each tag must be at most ${MAX_TAG_LENGTH} characters`
        )
    )
    .max(MAX_TAGS, `At most ${MAX_TAGS} tags are allowed`),
  price: z.number().positive('Price must be greater than 0'),
  salePrice: z.number().positive('Sale price must be greater than 0').optional(),
  stock: z
    .number()
    .int('Stock must be a whole number')
    .min(0, 'Stock cannot be negative'),
};

const SALE_PRICE_MESSAGE = 'Sale price must be less than price';

// `slug`, `status` and `shopId` are deliberately absent from the create shape.
// `.strict()` turns any of them appearing in a request body into a 400 —
// shopId always comes from the authenticated shop, slug is derived from the
// title server-side, and status is always ACTIVE on create.
// Defaults live only on create. Putting them on the shared shape would make
// them survive `.partial()`, so an empty PATCH body would parse into
// { tags: [], stock: 0 } and quietly wipe both fields.
export const productCreateSchema = z
  .object({
    ...productBaseShape,
    tags: productBaseShape.tags.default([]),
    stock: productBaseShape.stock.default(0),
  })
  .strict()
  .refine((data) => data.salePrice === undefined || data.salePrice < data.price, {
    message: SALE_PRICE_MESSAGE,
    path: ['salePrice'],
  });

export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/**
 * What a form holds *before* zod applies the defaults above.
 *
 * `tags` and `stock` carry `.default(...)`, so they are optional on the way in
 * and guaranteed on the way out. A form binds to this side; the submit handler
 * receives ProductCreateInput.
 */
export type ProductCreateFormInput = z.input<typeof productCreateSchema>;

export const productUpdateSchema = z
  .object({
    ...productBaseShape,
    // Sending null clears an existing sale price.
    salePrice: z
      .number()
      .positive('Sale price must be greater than 0')
      .nullable()
      .optional(),
    // DELETED is absent by design — soft delete goes through
    // DELETE /product/:id only, so exactly one path retires a product.
    status: z.enum(['ACTIVE', 'DRAFT']).optional(),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'No fields to update',
  })
  .refine(
    (data) =>
      data.salePrice === undefined ||
      data.salePrice === null ||
      data.price === undefined ||
      data.salePrice < data.price,
    { message: SALE_PRICE_MESSAGE, path: ['salePrice'] }
  );

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ProductListQueryInput = z.infer<typeof productListQuerySchema>;

// The browser uploads straight to ImageKit and posts back what it got. Neither
// field is trusted: the server re-fetches the file by id and stores ImageKit's
// own url. The charset guard is load-bearing rather than cosmetic — fileId is
// interpolated into the ImageKit management API path, so it must not be able to
// carry a path separator or a query string.
export const productImageCreateSchema = z
  .object({
    fileId: z
      .string()
      .trim()
      .min(1, 'fileId is required')
      .max(128, 'fileId is too long')
      .regex(/^[A-Za-z0-9_-]+$/, 'Invalid fileId'),
    url: z.string().trim().url('Invalid URL'),
  })
  .strict();

export type ProductImageCreateInput = z.infer<typeof productImageCreateSchema>;
