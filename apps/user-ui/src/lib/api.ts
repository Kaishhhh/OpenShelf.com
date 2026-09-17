import type {
  BuyerOrder,
  CartResponse,
  CheckoutResponse,
  LoginInput,
  OrderPage,
  RegisterInput,
  ResendOtpInput,
  VerifyOtpInput,
} from '@openshelf/types';
import { catalogueQuery } from './catalogue-filters';
import type {
  CatalogueFilters,
  CataloguePage,
  ProductDetail,
  ShopPage,
} from './catalogue-types';

// The response shapes live in one module so the server client can share them.
export type {
  CatalogueFilters,
  CataloguePage,
  CatalogueProduct,
  ProductDetail,
  ProductImage,
  ShopByline,
  ShopCard,
  ShopPage,
  ShopProfile,
} from './catalogue-types';
export { catalogueQuery } from './catalogue-filters';

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

// The cart goes through the gateway, unlike the server-side catalogue reads in
// server-api.ts: these are browser requests and they need the auth cookie, which is
// exactly what the gateway is there to carry.
const ORDER_BASE_URL =
  process.env.NEXT_PUBLIC_ORDER_API_URL ?? 'http://localhost:8080/order';

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

// Cart calls omit the 5th argument, so credentials are included.
const cartRequest = <T>(method: string, path: string, body?: unknown) =>
  send<T>(method, ORDER_BASE_URL, path, body);

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

export function listPublicProducts(filters: CatalogueFilters = {}) {
  return publicGet<CataloguePage>(
    PRODUCT_BASE_URL,
    `/public${catalogueQuery(filters)}`
  );
}

/** 404s for a DRAFT or DELETED product, or one whose shop is not approved. */
export function getPublicProduct(slug: string) {
  return publicGet<ProductDetail>(
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

// --- cart -----------------------------------------------------------------

/**
 * Every cart call answers with the whole cart, so a mutation's response can be dropped
 * straight into the ['cart'] query rather than triggering a refetch.
 *
 * All of them 401 for an anonymous visitor — callers treat that as "not logged in"
 * rather than as a failure.
 */
export function getCart() {
  return cartRequest<CartResponse>('GET', '/cart');
}

export function addCartItem(input: { productId: string; quantity?: number }) {
  return cartRequest<CartResponse>('POST', '/cart/items', input);
}

export function updateCartItem(productId: string, quantity: number) {
  return cartRequest<CartResponse>(
    'PATCH',
    `/cart/items/${encodeURIComponent(productId)}`,
    { quantity }
  );
}

export function removeCartItem(productId: string) {
  return cartRequest<CartResponse>(
    'DELETE',
    `/cart/items/${encodeURIComponent(productId)}`
  );
}

export function clearCart() {
  return cartRequest<CartResponse>('DELETE', '/cart');
}

// --- checkout and orders --------------------------------------------------

/**
 * Starts paying for the cart. No body: the server recomputes the total from the cart it
 * holds, so there is nothing a client could usefully send.
 *
 * 400s with the cart's notices as `details` when the cart changed since it was last read.
 */
export function startCheckout() {
  return cartRequest<CheckoutResponse>('POST', '/checkout');
}

/** Money in the response is integer cents. */
export function listOrders(
  params: { page?: number; limit?: number; paymentIntentId?: string } = {}
) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.paymentIntentId) query.set('paymentIntentId', params.paymentIntentId);
  const qs = query.toString();
  return cartRequest<OrderPage>('GET', `/orders${qs ? `?${qs}` : ''}`);
}

/** 404s for an order that is not the caller's. */
export function getOrder(id: string) {
  return cartRequest<BuyerOrder>('GET', `/orders/${encodeURIComponent(id)}`);
}
