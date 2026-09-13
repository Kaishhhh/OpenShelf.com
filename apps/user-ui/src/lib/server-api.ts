// Throws at build time if this module is ever pulled into a client bundle, which would
// mean the internal service URL had been shipped to the browser.
import 'server-only';

import { catalogueQuery } from './catalogue-filters';
import type {
  CatalogueFilters,
  CataloguePage,
  ProductDetail,
  ShopPage,
} from './catalogue-types';

/**
 * Server components talk to product-service directly, not through the gateway.
 *
 * The gateway exists for browser traffic — CORS, cookie forwarding, and a rate limiter
 * keyed on IP. None of that applies server-to-server, and going through it would put
 * every rendered page into the anonymous 100-req/min bucket behind the Next server's
 * single IP, which is exactly the ceiling a crawler would walk into.
 *
 * No NEXT_PUBLIC_ prefix: this value must never reach the client. `server-only` above
 * makes an accidental client import a build error rather than a silent leak.
 */
const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:6002';

/** Caching windows, kept together so the policy is readable in one place. */
const CACHE = {
  /**
   * Stable URLs that crawlers index. A seller's edit takes up to this long to appear,
   * which is the deliberate trade for not hitting the database on every crawl.
   */
  indexed: { next: { revalidate: 60 } },
  /**
   * The filtered list. Every filter combination is its own cache key, so the hit rate
   * would be poor anyway — and this is the page a seller reloads right after publishing,
   * where staleness is most obvious.
   */
  live: { cache: 'no-store' as const },
} satisfies Record<string, RequestInit>;

async function read<T>(path: string, init: RequestInit): Promise<T | null> {
  const res = await fetch(`${PRODUCT_SERVICE_URL}${path}`, init);

  // 404 is an answer, not a failure: a DRAFT product, an unapproved shop and a slug that
  // never existed all land here, and the caller decides between notFound() and an empty
  // state. Anything else throws, so a broken upstream surfaces as an error rather than
  // rendering as "no results".
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `product-service ${res.status} for ${path}`
    );
  }

  return (await res.json()) as T;
}

export function fetchProducts(
  filters: CatalogueFilters = {}
): Promise<CataloguePage | null> {
  return read<CataloguePage>(
    `/api/product/public${catalogueQuery(filters)}`,
    CACHE.live
  );
}

/** The landing page's recent row — indexed, so it takes the cached path. */
export function fetchRecentProducts(
  limit = 8
): Promise<CataloguePage | null> {
  return read<CataloguePage>(
    `/api/product/public${catalogueQuery({ limit, sort: 'newest' })}`,
    CACHE.indexed
  );
}

export function fetchProduct(slug: string): Promise<ProductDetail | null> {
  return read<ProductDetail>(
    `/api/product/public/${encodeURIComponent(slug)}`,
    CACHE.indexed
  );
}

export function fetchShop(
  id: string,
  filters: CatalogueFilters = {}
): Promise<ShopPage | null> {
  return read<ShopPage>(
    `/api/shop/public/${encodeURIComponent(id)}${catalogueQuery(filters)}`,
    CACHE.indexed
  );
}
