import type {
  LoginInput,
  ProductCreateInput,
  ProductUpdateInput,
  ResendOtpInput,
  SellerRegisterInput,
  ShopCreateInput,
  ShopStatus,
  VerifyOtpInput,
} from '@openshelf/types';

// The gateway strips the /seller mount before proxying to seller-service,
// so every path below is relative to it. apps/seller-ui/.env is gitignored,
// so this fallback is the value a fresh clone actually runs on.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/seller';

// product-service sits behind a different gateway mount, so it needs its own
// base rather than a path prefix. Kept as a separate variable instead of
// re-deriving it from NEXT_PUBLIC_API_URL, which already means "/seller" in an
// existing .env and would break silently if its meaning changed.
const PRODUCT_BASE_URL =
  process.env.NEXT_PUBLIC_PRODUCT_API_URL ?? 'http://localhost:8080/product';

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

// credentials: 'include' on every call — auth is httpOnly cookies set by the
// service, and the gateway's CORS is credentials: true against an origin allowlist.
async function send<T>(
  method: string,
  base: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    credentials: 'include',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });

  return toResult<T>(res);
}

const apiGet = <T>(path: string) => send<T>('GET', API_BASE_URL, path);
const apiPost = <T>(path: string, body: unknown) =>
  send<T>('POST', API_BASE_URL, path, body);

const productGet = <T>(path: string) => send<T>('GET', PRODUCT_BASE_URL, path);
const productPost = <T>(path: string, body: unknown) =>
  send<T>('POST', PRODUCT_BASE_URL, path, body);
const productPatch = <T>(path: string, body: unknown) =>
  send<T>('PATCH', PRODUCT_BASE_URL, path, body);
const productDelete = <T>(path: string) =>
  send<T>('DELETE', PRODUCT_BASE_URL, path);

export interface ShopSocialLinks {
  instagram?: string;
  facebook?: string;
  x?: string;
  tiktok?: string;
}

export interface Shop {
  id: string;
  name: string;
  bio: string | null;
  // Typed as string, not Category: this describes what the API returns, and
  // a row created before the category list existed can hold anything.
  category: string;
  avatar: string | null;
  coverBanner: string | null;
  address: string;
  openingHours: string | null;
  website: string | null;
  socialLinks: ShopSocialLinks | null;
  ratings: number;
  status: ShopStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  sellerId: string;
}

export interface SellerSummary {
  id: string;
  name: string;
  email: string;
}

export function registerSeller(input: SellerRegisterInput) {
  return apiPost<{ message: string }>('/register', input);
}

export function verifyOtp(input: VerifyOtpInput) {
  return apiPost<{ message: string }>('/verify-otp', input);
}

/** Always 200, whether or not a code was actually sent. */
export function resendOtp(input: ResendOtpInput) {
  return apiPost<{ message: string }>('/resend-otp', input);
}

export function loginSeller(input: LoginInput) {
  return apiPost<SellerSummary>('/login', input);
}

/** 404s when the seller has no shop yet — a normal state, not a failure. */
export function getShop() {
  return apiGet<Shop>('/shop');
}

/**
 * Creates the seller's shop, or resubmits it when the existing one was
 * rejected — the server decides which, and answers 201 or 200 accordingly.
 */
export function createShop(input: ShopCreateInput) {
  return apiPost<Shop>('/shop', input);
}

// --- products -------------------------------------------------------------

export type ProductStatus = 'ACTIVE' | 'DRAFT' | 'DELETED';

export interface ProductImage {
  id: string;
  fileId: string;
  url: string;
}

export interface Product {
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
  status: ProductStatus;
  shopId: string;
  createdAt: string;
  updatedAt: string;
  /** Present on GET /mine and GET /:id; absent from create and update responses. */
  images?: ProductImage[];
}

export interface ProductPage {
  products: Product[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UploadAuth {
  publicKey: string;
  token: string;
  expire: number;
  signature: string;
}

export function listMyProducts(page = 1, limit = 20) {
  return productGet<ProductPage>(`/mine?page=${page}&limit=${limit}`);
}

export function getProduct(id: string) {
  return productGet<Product>(`/${id}`);
}

export function createProduct(input: ProductCreateInput) {
  return productPost<Product>('/', input);
}

/**
 * Every product schema is `.strict()`, so the caller must pass only changed
 * fields — spreading a fetched product back would 400 on id, slug and shopId.
 */
export function updateProduct(id: string, input: ProductUpdateInput) {
  return productPatch<Product>(`/${id}`, input);
}

export function deleteProduct(id: string) {
  return productDelete<{
    id: string;
    status: 'DELETED';
    imagesDeleted: number;
    imagesFailed?: number;
  }>(`/${id}`);
}

/** Signed, short-lived, and single-use — fetch one per file. */
export function getUploadAuth() {
  return productGet<UploadAuth>('/upload-auth');
}

export function addProductImage(
  productId: string,
  input: { fileId: string; url: string }
) {
  return productPost<ProductImage>(`/${productId}/images`, input);
}

export function deleteProductImage(productId: string, imageId: string) {
  return productDelete<{ id: string }>(`/${productId}/images/${imageId}`);
}
