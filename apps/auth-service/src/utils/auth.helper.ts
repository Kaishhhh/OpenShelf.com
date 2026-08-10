import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { ValidationError } from '@openshelf/errors';

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface PendingRegistration {
  name: string;
  email: string;
  hashedPassword: string;
}

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.issues);
  }
  return result.data;
}

export const OTP_TTL_SECONDS = 300;
export const COOLDOWN_TTL_SECONDS = 60;
export const ATTEMPTS_TTL_SECONDS = 300;
export const LOCK_TTL_SECONDS = 1800;
export const MAX_OTP_ATTEMPTS = 5;
export const BCRYPT_COST = 12;

export const otpKey = (email: string) => `otp:${email}`;
export const pendingRegKey = (email: string) => `pending_reg:${email}`;
export const otpCooldownKey = (email: string) => `otp_cooldown:${email}`;
export const otpLockKey = (email: string) => `otp_lock:${email}`;
export const otpAttemptsKey = (email: string) => `otp_attempts:${email}`;

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPTS_TTL_SECONDS = 900;
export const LOGIN_LOCK_TTL_SECONDS = 900;

export const loginAttemptsKey = (email: string) => `login_attempts:${email}`;
export const loginLockKey = (email: string) => `login_lock:${email}`;

if (!process.env.ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET is not set');
}
if (!process.env.REFRESH_TOKEN_SECRET) {
  throw new Error('REFRESH_TOKEN_SECRET is not set');
}

export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthTokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET as string, {
    expiresIn: '15m',
  });
}

export function signRefreshToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET as string, {
    expiresIn: '7d',
  });
}
