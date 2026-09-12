/**
 * The categories a shop or a product can be filed under.
 *
 * Single source of truth for `shopCreateSchema.category`, `productCreateSchema.category`
 * and the selects in seller-ui, so a form cannot offer a value the server would reject.
 * Shops and products deliberately share one vocabulary — a product filed under a
 * category no shop can belong to would be unreachable by browsing.
 *
 * Unlike COUNTRIES there is no code/name split — the stored value is the label — so this
 * is a flat tuple that `z.enum` takes directly, with no `.map()` and no tuple assertion.
 *
 * Renaming an entry invalidates data already stored against the old string.
 */
export const CATEGORIES = [
  'Electronics',
  'Fashion',
  'Home & Garden',
  'Beauty',
  'Sports',
  'Toys',
  'Books',
  'Food & Drink',
  'Handmade',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];
