import type {
  LoginInput,
  RegisterInput,
  ResendOtpInput,
  VerifyOtpInput,
} from '@openshelf/types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6001/api';

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

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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
  return apiPost<{ id: string; name: string; email: string }>(
    '/login',
    input
  );
}
