import type {
  LoginInput,
  ResendOtpInput,
  SellerRegisterInput,
  ShopStatus,
  VerifyOtpInput,
} from '@openshelf/types';

// The gateway strips the /seller mount before proxying to seller-service,
// so every path below is relative to it. apps/seller-ui/.env is gitignored,
// so this fallback is the value a fresh clone actually runs on.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/seller';

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
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return toResult<T>(res);
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    credentials: 'include',
  });

  return toResult<T>(res);
}

export interface Shop {
  id: string;
  name: string;
  bio: string | null;
  category: string;
  avatar: string | null;
  coverBanner: string | null;
  address: string;
  openingHours: string | null;
  website: string | null;
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
