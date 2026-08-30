import { z } from 'zod';
import { NotFoundError, ValidationError } from '@openshelf/errors';

export {
  productCreateSchema,
  productUpdateSchema,
  productListQuerySchema,
  productImageCreateSchema,
  type ProductCreateInput,
  type ProductUpdateInput,
  type ProductListQueryInput,
  type ProductImageCreateInput,
} from '@openshelf/types';

export const PRODUCT_NOT_FOUND_MESSAGE = 'Product not found';
export const IMAGE_NOT_FOUND_MESSAGE = 'Image not found';

export const MAX_PRODUCT_IMAGES = 8;

/**
 * The browser uploads direct to ImageKit, so no body-size limit on this service
 * ever sees the file. The size reported back by the media API is the only place
 * the server can enforce a ceiling at all.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MAX_SLUG_LENGTH = 80;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
// Combining diacritical marks, left behind by NFKD decomposition.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.issues);
  }
  return result.data;
}

/**
 * Derives a URL-safe slug from a product title. NFKD + stripping combining
 * marks folds accents onto their base letter ("Crème" -> "creme") instead of
 * splitting the word. Titles made entirely of characters that don't survive
 * the transform (CJK, emoji) collapse to an empty string, so they fall back to
 * a constant and rely on the uniqueness suffix to stay distinct.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return slug || 'product';
}

export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Prisma raises P2023 ("Malformed ObjectID") for ids that aren't 24 hex
 * characters, which would surface as a 500 and would also make a malformed id
 * distinguishable from another shop's id. Rejecting up front keeps every
 * "not yours / not there" outcome a uniform 404.
 */
export function parseObjectId(
  raw: unknown,
  message = PRODUCT_NOT_FOUND_MESSAGE
): string {
  const id = String(raw ?? '');
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new NotFoundError(message);
  }
  return id;
}
