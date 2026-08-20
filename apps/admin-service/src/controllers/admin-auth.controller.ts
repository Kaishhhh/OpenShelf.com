import { CookieOptions, Request, Response } from 'express';
import { AuthError, RateLimitError } from '@openshelf/errors';
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
  cookieFlags,
  deleteAllRefreshTokensForUser,
  loginLockKey,
  refreshTokenKey,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@openshelf/auth';
import { loginSchema, parseOrThrow } from '../utils/admin-auth.helper.js';

const NAMESPACE = 'admin';
const ADMIN_ROLE = 'ADMIN';

function authCookieOptions(maxAge: number): CookieOptions {
  return { ...cookieFlags(), maxAge };
}

export async function login(req: Request, res: Response) {
  const { email, password } = parseOrThrow(loginSchema, req.body);

  if (await redis.exists(loginLockKey(NAMESPACE, email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  const passwordMatches = admin
    ? await comparePassword(password, admin.password)
    : false;

  if (!admin || !passwordMatches) {
    await checkAndBumpLoginAttempts(NAMESPACE, email);
    return; // unreachable — checkAndBumpLoginAttempts always throws
  }

  await clearLoginAttempts(NAMESPACE, email);

  const payload = { sub: admin.id, role: ADMIN_ROLE };
  const accessToken = signAccessToken(payload);
  const { token: refreshToken, jti } = signRefreshToken(payload);
  await redis.set(
    refreshTokenKey(NAMESPACE, admin.id, jti),
    '1',
    'EX',
    REFRESH_TOKEN_TTL_SECONDS
  );

  return res
    .cookie('access_token', accessToken, authCookieOptions(ACCESS_TOKEN_MAX_AGE_MS))
    .cookie('refresh_token', refreshToken, authCookieOptions(REFRESH_TOKEN_MAX_AGE_MS))
    .status(200)
    .json({ id: admin.id, name: admin.name, email: admin.email });
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
    console.error('[admin-service] Refresh token reuse detected', {
      adminId: decoded.sub,
      jti: decoded.jti,
    });
    throw new AuthError(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  await redis.del(tokenKey);

  const admin = await prisma.admin.findUnique({
    where: { id: decoded.sub },
  });
  if (!admin) {
    clearAuthCookies(res);
    throw new AuthError(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  const payload = { sub: admin.id, role: ADMIN_ROLE };
  const accessToken = signAccessToken(payload);
  const { token: newRefreshToken, jti: newJti } = signRefreshToken(payload);
  await redis.set(
    refreshTokenKey(NAMESPACE, admin.id, newJti),
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
    .json({ id: admin.id, name: admin.name, email: admin.email });
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
  const admin = req.admin;
  if (!admin) {
    throw new AuthError('Not authenticated');
  }

  return res
    .status(200)
    .json({ id: admin.id, name: admin.name, email: admin.email });
}
