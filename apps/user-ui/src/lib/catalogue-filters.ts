import { CATEGORIES, PRODUCT_SORTS, type Category } from '@openshelf/types';
import type { CatalogueFilters } from './catalogue-types';

/**
 * What a page receives from Next as `searchParams`, once awaited.
 *
 * A repeated key (`?category=a&category=b`) arrives as an array, which is why every
 * reader below narrows to the first value rather than assuming a string.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parses the URL into filters.
 *
 * Used by the server pages to fetch and by the client sidebar to show active state, so
 * both agree on what a URL means. Accepts either a plain object (the server prop) or a
 * URLSearchParams (the client hook).
 *
 * Anything unrecognised is dropped rather than forwarded: the API would strip it anyway
 * — publicProductListQuerySchema is not `.strict()` — but dropping it here keeps the
 * sidebar's active states honest for a hand-edited URL.
 */
export function parseFilters(
  input: RawSearchParams | URLSearchParams
): CatalogueFilters {
  const get = (key: string): string | undefined =>
    input instanceof URLSearchParams
      ? input.get(key) ?? undefined
      : first(input[key]);

  const num = (key: string): number | undefined => {
    const raw = get(key);
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const category = get('category');
  const sort = get('sort');
  const shopId = get('shopId');

  return {
    page: num('page') ?? 1,
    category:
      category && (CATEGORIES as readonly string[]).includes(category)
        ? (category as Category)
        : undefined,
    minPrice: num('minPrice'),
    maxPrice: num('maxPrice'),
    // Matches the server's own guard so a junk id is not sent upstream at all.
    shopId: shopId && /^[0-9a-f]{24}$/i.test(shopId) ? shopId : undefined,
    sort:
      sort && (PRODUCT_SORTS as readonly string[]).includes(sort)
        ? (sort as CatalogueFilters['sort'])
        : undefined,
  };
}

/** Omits empty values so a default filter never appears in the URL. */
export function catalogueQuery(filters: CatalogueFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** True when anything beyond paging and sorting is narrowing the list. */
export function hasActiveFilters(filters: CatalogueFilters): boolean {
  return Boolean(
    filters.category ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      filters.shopId
  );
}
