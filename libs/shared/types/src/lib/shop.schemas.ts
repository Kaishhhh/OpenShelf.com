import { z } from 'zod';
import { CATEGORIES } from './categories';
import { optionalText, optionalUrl } from './field-helpers';

/**
 * Mirrors the Prisma `ShopStatus` enum. Declared here so clients can name the
 * states without pulling in @prisma/client, the same way product.schemas.ts
 * mirrors ProductStatus.
 */
export const SHOP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

const shopSocialLinksSchema = z
  .object({
    instagram: optionalUrl(),
    facebook: optionalUrl(),
    x: optionalUrl(),
    tiktok: optionalUrl(),
  })
  .strict();

export const shopCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  category: z.enum(CATEGORIES, { message: 'Select a category' }),
  address: z
    .string()
    .trim()
    .min(1, 'Address is required')
    .max(300, 'Address is too long'),
  bio: optionalText(1000, 'Bio is too long'),
  openingHours: optionalText(200, 'Opening hours is too long'),
  website: optionalUrl(300),
  socialLinks: shopSocialLinksSchema.optional(),
});

export type ShopCreateInput = z.infer<typeof shopCreateSchema>;

export const shopRejectSchema = z.object({
  reason: z.string().trim().max(500, 'Reason is too long').optional(),
});

export type ShopRejectInput = z.infer<typeof shopRejectSchema>;

export const shopModerationQuerySchema = z.object({
  status: z
    .enum(['pending', 'approved', 'rejected', 'all'])
    .optional()
    .default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ShopModerationQueryInput = z.infer<
  typeof shopModerationQuerySchema
>;
