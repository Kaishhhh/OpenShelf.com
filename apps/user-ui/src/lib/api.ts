import type {
  Category,
  LoginInput,
  ProductSort,
  RegisterInput,
  ResendOtpInput,
  VerifyOtpInput,
} from '@openshelf/types';

// Auth lives behind the gateway's /auth mount. apps/user-ui/.env is gitignored,
// so these fallbacks are what a fresh clone actually runs on.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/auth';

// The catalogue sits behind two further gateway mounts. Separate variables
// rather than one derived base: NEXT_PUBLIC_API_URL already means "/auth" in an
// existing .env, and changing its meaning would break it silently.
const PRODUCT_BASE_URL =
  process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? 'http://localhost:8080/product';
const SHOP_BASE_URL =
  process.env.NEXT_PUBLIC_SHOP_API_URL ?? 'http://localhost:8080/shop';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function toResult<T>(res: Response): Promise<T> {
  // Parsed before the status check so an empty or non-JSON error body cannot
  // throw ahead of it.
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      data.message ?? 'Something went wrong',
      res.status,
      data.details
    );
  }

  return data as T;
}

async function send<T>(
  method: string,
  base: string,
  path: string,
  body?: unknown,
  // Catalogue reads are anonymous; only the auth calls need the cookie.
  withCredentials = true
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(withCredentials ? { credentials: 'include' as const } : {}),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });

  return toResult<T>(res);
}

const apiPost = <T>(path: string, body: unknown) =>
  send<T>('POST', API_BASE_URL, path, body);

const publicGet = <T>(base: string, path: string) =>
  send<T>('GET', base, path, undefined, false);

// --- auth -----------------------------------------------------------------

export function registerUser(input: RegisterInput) {
  return apiPost<{ message: string }>('/register', input);
}

export function verifyOtp(input: VerifyOtpInput) {
  return apiPost<{ message: string }>('/verify-otp', input);
}

/** Always 200, whether or not a code was actually sent. */
export function resendOtp(input: ResendOtpInput) {
  return apiPost<{ message: string }>('/resend-otp', input);
}

export function loginUser(input: LoginInput) {
  return apiPost<{ id: string; name: string; email: string }>('/login', input);
}

// --- catalogue ------------------------------------------------------------

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
}

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

export function listPublicProducts(filters: CatalogueFilters = {}) {
  return publicGet<CataloguePage>(
    PRODUCT_BASE_URL,
    `/public${catalogueQuery(filters)}`
  );
}

/** 404s for a DRAFT or DELETED product, or one whose shop is not approved. */
export function getPublicProduct(slug: string) {
  return publicGet<CatalogueProduct & { shop: ShopCard }>(
    PRODUCT_BASE_URL,
    `/public/${encodeURIComponent(slug)}`
  );
}

/** 404s unless the shop is APPROVED. */
export function getPublicShop(id: string, filters: CatalogueFilters = {}) {
  return publicGet<ShopPage>(
    SHOP_BASE_URL,
    `/public/${encodeURIComponent(id)}${catalogueQuery(filters)}`
  );
}
