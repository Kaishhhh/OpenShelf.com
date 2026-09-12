import { z } from 'zod';

/**
 * An optional field that treats blank as "not provided".
 *
 * An untouched browser input posts `""`, which `.url()` rejects — so without this a
 * seller who simply left "Website" alone could not submit the form at all. It also stops
 * empty strings being persisted where absence is what is meant.
 *
 * Built as trim → blank-to-undefined → validate rather than with `z.preprocess`, which
 * would widen the schema's *input* type to `unknown` and leave zodResolver unable to
 * match it against the inferred input type. Here the input type stays
 * `string | undefined`, which is what a form field actually holds.
 *
 * Not exported from the package barrel: these are building blocks for the schemas in
 * this lib, not part of what @openshelf/types offers its consumers.
 */
const optionalString = (inner: z.ZodString) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(inner.optional());

export const optionalText = (max: number, tooLong: string) =>
  optionalString(z.string().max(max, tooLong));

export const optionalUrl = (max = 300) =>
  optionalString(z.string().url('Invalid URL').max(max, 'URL is too long'));
