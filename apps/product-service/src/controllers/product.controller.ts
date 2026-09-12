import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  canonicalFileUrl,
  deleteFile,
  getFileById,
  getUploadAuth as getImageKitUploadAuth,
} from '@openshelf/imagekit';
import {
  IMAGE_NOT_FOUND_MESSAGE,
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  PRODUCT_NOT_FOUND_MESSAGE,
  parseObjectId,
  parseOrThrow,
  productCreateSchema,
  productImageCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  randomSlugSuffix,
  slugify,
} from '../utils/product.helper.js';

const MAX_SLUG_ATTEMPTS = 5;

// Only the columns a client needs. fileId is included so the seller UI can
// address a file, but nothing else about the ImageKit account is exposed.
const IMAGE_SELECT = { id: true, fileId: true, url: true } as const;

// Every query in this file scopes by this value. shopId is never read from
// req.body or req.query anywhere — a product belongs to the shop the caller is
// authenticated as, and nothing a client sends can widen that.
function requireShopId(req: Request): string {
  const shop = req.shop;
  if (!shop) {
    throw new ForbiddenError('Shop not found or not approved');
  }
  return shop.id;
}

function isSlugConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    String(err.meta?.target ?? '').includes('slug')
  );
}

export async function createProduct(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const data = parseOrThrow(productCreateSchema, req.body);

  const baseSlug = slugify(data.title);

  // Uniqueness rides on the DB's unique index rather than a findUnique
  // pre-check, so concurrent creates of the same title can't both pass a
  // check and then collide on write.
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;
    try {
      const product = await prisma.product.create({
        data: { ...data, slug, shopId },
      });
      return res.status(201).json(product);
    } catch (err) {
      if (!isSlugConflict(err)) {
        throw err;
      }
    }
  }

  throw new AppError('Could not generate a unique slug for this product', 500);
}

export async function listMyProducts(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const { page, limit } = parseOrThrow(productListQuerySchema, req.query);

  const where = { shopId, status: { not: 'DELETED' as const } };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      // The seller's list renders a thumbnail. Capped at MAX_PRODUCT_IMAGES
      // rows of three columns each, so this is far cheaper than the per-product
      // round trip the UI would otherwise have to make.
      include: { images: { select: IMAGE_SELECT } },
    }),
    prisma.product.count({ where }),
  ]);

  return res.status(200).json({
    products,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}

export async function getProduct(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseObjectId(req.params.id);

  // findFirst with shopId in the where — not findUnique(id) plus an ownership
  // check — so another shop's product is indistinguishable from a missing one.
  // 404, never 403: a 403 would confirm the id exists.
  const product = await prisma.product.findFirst({
    where: { id, shopId, status: { not: 'DELETED' } },
    include: { images: { select: IMAGE_SELECT } },
  });
  if (!product) {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  return res.status(200).json(product);
}

export async function updateProduct(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseObjectId(req.params.id);
  const data = parseOrThrow(productUpdateSchema, req.body);

  const existing = await prisma.product.findFirst({
    where: { id, shopId, status: { not: 'DELETED' } },
  });
  if (!existing) {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  // A PATCH may send only one side of the pair, so the invariant is checked
  // against the merged result. The schema covers the both-present case.
  const price = data.price ?? existing.price;
  const salePrice =
    data.salePrice === undefined ? existing.salePrice : data.salePrice;
  if (salePrice !== null && salePrice >= price) {
    throw new AppError('Sale price must be less than price', 400);
  }

  // Still scoped by shopId on the write, so re-reading above opens no
  // ownership gap between the check and the update.
  const { count } = await prisma.product.updateMany({
    where: { id, shopId, status: { not: 'DELETED' } },
    data,
  });
  if (count === 0) {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  const updated = await prisma.product.findFirst({ where: { id, shopId } });
  return res.status(200).json(updated);
}

export async function deleteProduct(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseObjectId(req.params.id);

  // Soft delete — the row stays, status moves to DELETED.
  const { count } = await prisma.product.updateMany({
    where: { id, shopId, status: { not: 'DELETED' } },
    data: { status: 'DELETED' },
  });
  if (count === 0) {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  // Cleanup runs after the status change, never before: if it ran first and the
  // update then failed, a still-live product would have lost its pictures.
  const removed = await purgeProductImages(id);

  return res.status(200).json({
    id,
    status: 'DELETED',
    imagesDeleted: removed.deleted,
    ...(removed.failed > 0 ? { imagesFailed: removed.failed } : {}),
  });
}

/**
 * Destroys a product's ImageKit files and the rows pointing at them.
 *
 * Best-effort by design. The delete the seller asked for has already happened,
 * so a file ImageKit refuses to remove must not turn the whole request into a
 * 500. Its row is left behind instead, which keeps the fileId recorded so the
 * failure can be retried rather than becoming an untracked remote file.
 * Sequential rather than parallel — capped at MAX_PRODUCT_IMAGES, and one
 * failure shouldn't obscure the rest.
 */
async function purgeProductImages(
  productId: string
): Promise<{ deleted: number; failed: number }> {
  const images = await prisma.image.findMany({ where: { productId } });

  let deleted = 0;
  let failed = 0;

  for (const image of images) {
    try {
      await deleteFile(image.fileId);
      await prisma.image.delete({ where: { id: image.id } });
      deleted++;
    } catch (err) {
      failed++;
      console.error(
        `Failed to remove ImageKit file ${image.fileId} for product ${productId} —`,
        err
      );
    }
  }

  return { deleted, failed };
}

export async function getUploadAuth(req: Request, res: Response) {
  // The guards already ran; this asserts req.shop rather than re-checking it,
  // so signed upload params are never minted for an unapproved shop.
  requireShopId(req);

  // publicKey, token, expire and signature cross this boundary — the four form
  // fields ImageKit's upload endpoint wants. The private key signs them
  // server-side and is never part of what the lib returns.
  const { publicKey, token, expire, signature } = getImageKitUploadAuth();
  return res.status(200).json({ publicKey, token, expire, signature });
}

export async function addProductImage(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseObjectId(req.params.id);
  const { fileId, url } = parseOrThrow(productImageCreateSchema, req.body);

  // Ownership first, before anything reaches ImageKit — another shop's product
  // 404s without this service ever making a call on its behalf.
  const product = await prisma.product.findFirst({
    where: { id, shopId, status: { not: 'DELETED' } },
    select: { id: true },
  });
  if (!product) {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  // Two posts racing at 7 images could both pass this. Bounded and harmless —
  // not worth a transaction for a cosmetic cap.
  const existing = await prisma.image.count({ where: { productId: id } });
  if (existing >= MAX_PRODUCT_IMAGES) {
    throw new AppError(
      `A product can have at most ${MAX_PRODUCT_IMAGES} images`,
      400
    );
  }

  // The whole defence against a forged fileId. This lookup authenticates with
  // the account private key, so an id belonging to another ImageKit account is
  // indistinguishable from one that was invented — both come back null.
  const file = await getFileById(fileId);
  if (!file || file.type !== 'file') {
    throw new ValidationError('Unknown ImageKit fileId');
  }

  // The only point at which the server learns the real size: the bytes went
  // browser -> ImageKit and never traversed this process.
  if (file.size > MAX_IMAGE_BYTES) {
    // Deliberately not deleted from ImageKit. It was uploaded against a
    // signature we issued, and destroying it here would make a retry
    // impossible; it simply never gets a row.
    throw new ValidationError(
      `Image must be at most ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB`
    );
  }

  // A valid fileId paired with a url pointing anywhere else is still a forgery,
  // so the two are still compared — but on origin+path, not as raw strings.
  // getFileDetails appends a `?updatedAt=<ms>` cache-buster that the upload
  // response the client is echoing back does not have, so the raw strings never
  // match even when both name the same file.
  const canonical = canonicalFileUrl(file.url);
  if (!canonical) {
    throw new AppError('ImageKit returned an unparseable url', 502);
  }
  if (canonical !== canonicalFileUrl(url)) {
    throw new ValidationError('url does not match the uploaded file');
  }

  // ImageKit's own url is what gets persisted, never the client's, and without
  // the cache-buster so that `?tr=...` can be appended to it directly.
  const image = await prisma.image.create({
    data: { fileId: file.fileId, url: canonical, productId: id },
    select: IMAGE_SELECT,
  });

  return res.status(201).json(image);
}

export async function deleteProductImage(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseObjectId(req.params.id);
  const imageId = parseObjectId(req.params.imageId, IMAGE_NOT_FOUND_MESSAGE);

  const product = await prisma.product.findFirst({
    where: { id, shopId, status: { not: 'DELETED' } },
    select: { id: true },
  });
  if (!product) {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  // Scoped by productId, which is itself already scoped to this shop, so an
  // image id belonging to another product cannot be reached through this route.
  const image = await prisma.image.findFirst({
    where: { id: imageId, productId: id },
  });
  if (!image) {
    throw new NotFoundError(IMAGE_NOT_FOUND_MESSAGE);
  }

  // Remote first. If this throws, the row survives and the request 500s: an
  // orphaned row can be retried, an orphaned remote file can never be found.
  await deleteFile(image.fileId);
  await prisma.image.delete({ where: { id: image.id } });

  return res.status(200).json({ id: image.id });
}

export async function getPublicProductBySlug(req: Request, res: Response) {
  const slug = String(req.params.slug ?? '');

  const product = await prisma.product.findFirst({
    where: { slug, status: 'ACTIVE' },
    include: { shop: true, images: { select: IMAGE_SELECT } },
  });

  // DRAFT and DELETED are excluded by the status filter; a shop that is not
  // APPROVED — PENDING or REJECTED — is excluded here. All of them produce the
  // same 404 as a slug that doesn't exist.
  if (!product || product.shop?.status !== 'APPROVED') {
    throw new NotFoundError(PRODUCT_NOT_FOUND_MESSAGE);
  }

  const { shop, ...rest } = product;
  return res.status(200).json({
    ...rest,
    shop: {
      id: shop.id,
      name: shop.name,
      avatar: shop.avatar,
      ratings: shop.ratings,
    },
  });
}
