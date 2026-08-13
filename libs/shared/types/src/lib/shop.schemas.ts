import { z } from 'zod';

const shopSocialLinksSchema = z
  .object({
    instagram: z.string().trim().url('Invalid URL').optional(),
    facebook: z.string().trim().url('Invalid URL').optional(),
    x: z.string().trim().url('Invalid URL').optional(),
    tiktok: z.string().trim().url('Invalid URL').optional(),
  })
  .strict();

export const shopCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  category: z
    .string()
    .trim()
    .min(1, 'Category is required')
    .max(100, 'Category is too long'),
  address: z
    .string()
    .trim()
    .min(1, 'Address is required')
    .max(300, 'Address is too long'),
  bio: z.string().trim().max(1000, 'Bio is too long').optional(),
  openingHours: z
    .string()
    .trim()
    .max(200, 'Opening hours is too long')
    .optional(),
  website: z
    .string()
    .trim()
    .url('Invalid URL')
    .max(300, 'URL is too long')
    .optional(),
  socialLinks: shopSocialLinksSchema.optional(),
});

export type ShopCreateInput = z.infer<typeof shopCreateSchema>;
