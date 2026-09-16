import type { Category, ProductSort } from '@openshelf/types';

/**
 * Shapes of the public catalogue responses.
 *
 * Types only, and deliberately in their own module: the browser client (api.ts) and the
 * server client (server-api.ts) both need them, and neither may pull the other's runtime
 * code in. A `import type` from either side erases completely.
 */

export interface ProductImage {
  id: string;
  fileId: string;
  url: string;
}

/** The trimmed shop a catalogue row carries. Never the whole Shop row. */
export interface ShopCard {
  id: string;
  name: string;
  category: string;
}

/**
 * The shop on a product *detail* response.
 *
 * Deliberately different from ShopCard: getPublicProductBySlug projects
 * `{ id, name, avatar, ratings }` by hand rather than reusing the list endpoint's
 * PUBLIC_SHOP_CARD, so there is no `category` here and there are two fields the card
 * does not have. Typing both as ShopCard made `shop.category` look like a string when
 * it is undefined at runtime.
 */
export interface ShopByline {
  id: string;
  name: string;
  avatar: string | null;
  ratings: number;
}

export interface CatalogueProduct {
  id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  subCategory: string | null;
  tags: string[];
  price: number;
  salePrice: number | null;
  stock: number;
  shopId: string;
  createdAt: string;
  images: ProductImage[];
  shop?: ShopCard;
  /**
   * Whether the seller can currently receive funds. Derived live upstream; a false
   * product is still listed, it just can't be bought. order-service enforces this —
   * the UI only reflects it.
   */
  purchasable: boolean;
}

export type ProductDetail = Omit<CatalogueProduct, 'shop'> & {
  shop: ShopByline;
};

export interface ShopProfile {
  id: string;
  name: string;
  bio: string | null;
  category: string;
  avatar: string | null;
  coverBanner: string | null;
  openingHours: string | null;
  website: string | null;
  socialLinks: Record<string, string> | null;
  ratings: number;
  createdAt: string;
  purchasable: boolean;
}

export interface CataloguePage {
  products: CatalogueProduct[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ShopPage extends CataloguePage {
  shop: ShopProfile;
}

export interface CatalogueFilters {
  page?: number;
  limit?: number;
  category?: Category;
  minPrice?: number;
  maxPrice?: number;
  shopId?: string;
  sort?: ProductSort;
}
