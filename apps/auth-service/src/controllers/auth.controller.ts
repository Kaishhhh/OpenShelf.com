import { CookieOptions, Request, Response } from 'express';
import { AuthError, RateLimitError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { redis } from '@openshelf/redis';
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  INVALID_REFRESH_TOKEN_MESSAGE,
  REFRESH_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_TTL_SECONDS,
  TOO_MANY_ATTEMPTS_MESSAGE,
  checkAndBumpLoginAttempts,
  clearAuthCookies,
  clearLoginAttempts,
  comparePassword,
  consumeOtp,
  cookieFlags,
  deleteAllRefreshTokensForUser,
  hashPassword,
  issueOtp,
  loginLockKey,
  otpCooldownKey,
  otpLockKey,
  refreshTokenKey,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@openshelf/auth';
import {
  PendingRegistration,
  loginSchema,
  parseOrThrow,
  registerSchema,
  verifyOtpSchema,
} from '../utils/auth.helper.js';

const NAMESPACE = 'user';

const REGISTER_SUCCESS_MESSAGE =
  'Verification code sent. Please check your email.';

function authCookieOptions(maxAge: number): CookieOptions {
  return { ...cookieFlags(), maxAge };
}

export async function register(req: Request, res: Response) {
  const { name, email, password } = parseOrThrow(registerSchema, req.body);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    // Same response as a fresh registration, no side effects — never
    // reveal whether an account already exists for this email.
    return res.status(200).json({ message: REGISTER_SUCCESS_MESSAGE });
  }

  if (await redis.exists(otpCooldownKey(NAMESPACE, email))) {
    throw new RateLimitError('Please wait before requesting another code');
  }
  if (await redis.exists(otpLockKey(NAMESPACE, email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const hashedPassword = await hashPassword(password);
  const pending: PendingRegistration = { name, email, hashedPassword };
  const otp = await issueOtp(NAMESPACE, email, pending);

  // TODO: send `otp` to `email` via the transactional email provider
  console.log(`[auth-service] TODO send OTP email to ${email}: ${otp}`);

  return res.status(200).json({ message: REGISTER_SUCCESS_MESSAGE });
}

export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = parseOrThrow(verifyOtpSchema, req.body);

  const pending = await consumeOtp<PendingRegistration>(
    NAMESPACE,
    email,
    otp
  );

  // Someone could have registered this email through a separate path in
  // the window between register and verify-otp — re-check before creating.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ValidationError('An account with this email already exists');
  }

  await prisma.user.create({
    data: {
      name: pending.name,
      email: pending.email,
      password: pending.hashedPassword,
      emailVerified: true,
    },
  });

  return res
    .status(200)
    .json({ message: 'Registration complete. You can now log in.' });
}

export async function login(req: Request, res: Response) {
  const { email, password } = parseOrThrow(loginSchema, req.body);

  if (await redis.exists(loginLockKey(NAMESPACE, email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = user?.password
    ? await comparePassword(password, user.password)
    : false;

  if (!user || !passwordMatches) {
    await checkAndBumpLoginAttempts(NAMESPACE, email);
    return; // unreachable — checkAndBumpLoginAttempts always throws
  }

  if (!user.emailVerified) {
    throw new AuthError('Please verify your email before logging in');
  }

  await clearLoginAttempts(NAMESPACE, email);

  const payload = { sub: user.id, role: user.role };
  const accessToken = signAccessToken(payload);
  const { token: refreshToken, jti } = signRefreshToken(payload);
  await redis.set(
    refreshTokenKey(NAMESPACE, user.id, jti),
    '1',
    'EX',
    REFRESH_TOKEN_TTL_SECONDS
  );

  return res
    .cookie('access_token', accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE_MS))
    .cookie('refresh_token', refreshToken, authCookieOptions(REFRESH_TOKEN_MAX_AGE_MS))
    .status(200)
    .json({ id: user.id, name: user.name, email: user.email });
}

export async function refreshToken(req: Request, res: Response) {
  const token = req.cookies?.refresh_token;
  if (!token) {
    throw new AuthError(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  const decoded = verifyRefreshToken(token);
  const tokenKey = refreshTokenKey(NAMESPACE, decoded.sub, decoded.jti);

  if (!(await redis.exists(tokenKey))) {
    await deleteAllRefreshTokensForUser(NAMESPACE, decoded.sub);
    clearAuthCookies(res);
    console.error('[auth-service] Refresh token reuse detected', {
      userId: decoded.sub,
      jti: decoded.jti,
    });
    throw new AuthError(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  await redis.del(tokenKey);

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user) {
    clearAuthCookies(res);
    throw new AuthError(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  const payload = { sub: user.id, role: user.role };
  const accessToken = signAccessToken(payload);
  const { token: newRefreshToken, jti: newJti } = signRefreshToken(payload);
  await redis.set(
    refreshTokenKey(NAMESPACE, user.id, newJti),
    '1',
    'EX',
    REFRESH_TOKEN_TTL_SECONDS
  );

  return res
    .cookie('access_token', accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE_MS))
    .cookie(
      'refresh_token',
      newRefreshToken,
      authCookieOptions(REFRESH_TOKEN_MAX_AGE_MS)
    )
    .status(200)
    .json({ id: user.id, name: user.name, email: user.email });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.refresh_token;

  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      await redis.del(refreshTokenKey(NAMESPACE, decoded.sub, decoded.jti));
    } catch {
      // Logout is idempotent — an invalid, expired, or already-revoked
      // token is not an error here.
    }
  }

  clearAuthCookies(res);
  return res.status(200).json({ message: 'Logged out' });
}

export async function me(req: Request, res: Response) {
  const user = req.user;
  if (!user) {
    throw new AuthError('Not authenticated');
  }

  return res
    .status(200)
    .json({ id: user.id, name: user.name, email: user.email });
}
