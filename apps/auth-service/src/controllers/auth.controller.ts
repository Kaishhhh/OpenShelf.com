import { CookieOptions, Request, Response } from 'express';
import { AuthError, RateLimitError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { redis } from '@openshelf/redis';
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  ATTEMPTS_TTL_SECONDS,
  COOLDOWN_TTL_SECONDS,
  LOCK_TTL_SECONDS,
  LOGIN_ATTEMPTS_TTL_SECONDS,
  LOGIN_LOCK_TTL_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_SECONDS,
  PendingRegistration,
  REFRESH_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_TTL_SECONDS,
  comparePassword,
  deleteAllRefreshTokensForUser,
  generateOtp,
  hashPassword,
  loginAttemptsKey,
  loginLockKey,
  loginSchema,
  otpAttemptsKey,
  otpCooldownKey,
  otpKey,
  otpLockKey,
  parseOrThrow,
  pendingRegKey,
  refreshTokenKey,
  registerSchema,
  signAccessToken,
  signRefreshToken,
  verifyOtpSchema,
  verifyRefreshToken,
} from '../utils/auth.helper.js';

const REGISTER_SUCCESS_MESSAGE =
  'Verification code sent. Please check your email.';
const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many failed attempts, please try again later';
const CODE_INVALID_MESSAGE = 'Code expired or invalid';
const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';

function cookieFlags(): Omit<CookieOptions, 'maxAge'> {
  return {
    httpOnly: true,
    secure: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    path: '/',
  };
}

function authCookieOptions(maxAge: number): CookieOptions {
  return { ...cookieFlags(), maxAge };
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', cookieFlags());
  res.clearCookie('refresh_token', cookieFlags());
}

export async function register(req: Request, res: Response) {
  const { name, email, password } = parseOrThrow(registerSchema, req.body);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    // Same response as a fresh registration, no side effects — never
    // reveal whether an account already exists for this email.
    return res.status(200).json({ message: REGISTER_SUCCESS_MESSAGE });
  }

  if (await redis.exists(otpCooldownKey(email))) {
    throw new RateLimitError('Please wait before requesting another code');
  }
  if (await redis.exists(otpLockKey(email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const hashedPassword = await hashPassword(password);
  const otp = generateOtp();
  const pending: PendingRegistration = { name, email, hashedPassword };

  await redis
    .pipeline()
    .set(otpKey(email), otp, 'EX', OTP_TTL_SECONDS)
    .set(pendingRegKey(email), JSON.stringify(pending), 'EX', OTP_TTL_SECONDS)
    .set(otpCooldownKey(email), '1', 'EX', COOLDOWN_TTL_SECONDS)
    .exec();

  // TODO: send `otp` to `email` via the transactional email provider
  console.log(`[auth-service] TODO send OTP email to ${email}: ${otp}`);

  return res.status(200).json({ message: REGISTER_SUCCESS_MESSAGE });
}

export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = parseOrThrow(verifyOtpSchema, req.body);

  if (await redis.exists(otpLockKey(email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const storedOtp = await redis.get(otpKey(email));
  if (!storedOtp) {
    throw new ValidationError(CODE_INVALID_MESSAGE);
  }

  if (storedOtp !== otp) {
    const attempts = await redis.incr(otpAttemptsKey(email));
    if (attempts === 1) {
      await redis.expire(otpAttemptsKey(email), ATTEMPTS_TTL_SECONDS);
    }
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await redis.set(otpLockKey(email), '1', 'EX', LOCK_TTL_SECONDS);
      throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
    }
    throw new ValidationError(CODE_INVALID_MESSAGE);
  }

  const pendingRaw = await redis.get(pendingRegKey(email));
  if (!pendingRaw) {
    throw new ValidationError(CODE_INVALID_MESSAGE);
  }
  const pending: PendingRegistration = JSON.parse(pendingRaw);

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

  await redis.del(otpKey(email), pendingRegKey(email), otpAttemptsKey(email));

  return res
    .status(200)
    .json({ message: 'Registration complete. You can now log in.' });
}

export async function login(req: Request, res: Response) {
  const { email, password } = parseOrThrow(loginSchema, req.body);

  if (await redis.exists(loginLockKey(email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = user?.password
    ? await comparePassword(password, user.password)
    : false;

  if (!user || !passwordMatches) {
    const attempts = await redis.incr(loginAttemptsKey(email));
    if (attempts === 1) {
      await redis.expire(loginAttemptsKey(email), LOGIN_ATTEMPTS_TTL_SECONDS);
    }
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await redis.set(loginLockKey(email), '1', 'EX', LOGIN_LOCK_TTL_SECONDS);
      throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
    }
    throw new AuthError(INVALID_CREDENTIALS_MESSAGE);
  }

  if (!user.emailVerified) {
    throw new AuthError('Please verify your email before logging in');
  }

  await redis.del(loginAttemptsKey(email));

  const payload = { sub: user.id, role: user.role };
  const accessToken = signAccessToken(payload);
  const { token: refreshToken, jti } = signRefreshToken(payload);
  await redis.set(
    refreshTokenKey(user.id, jti),
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
  const tokenKey = refreshTokenKey(decoded.sub, decoded.jti);

  if (!(await redis.exists(tokenKey))) {
    await deleteAllRefreshTokensForUser(decoded.sub);
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
    refreshTokenKey(user.id, newJti),
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
      await redis.del(refreshTokenKey(decoded.sub, decoded.jti));
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
