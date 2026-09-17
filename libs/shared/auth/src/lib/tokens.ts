import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import { redis } from '@openshelf/redis';
import { refreshTokenKey } from './keys.js';
import {
  INVALID_REFRESH_TOKEN_MESSAGE,
  NOT_AUTHENTICATED_MESSAGE,
} from './messages.js';

if (!process.env.ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET is not set');
}
if (!process.env.REFRESH_TOKEN_SECRET) {
  throw new Error('REFRESH_TOKEN_SECRET is not set');
}

export interface AuthTokenPayload {
  sub: string;
  role: string;
}

export interface RefreshTokenPayload extends AuthTokenPayload {
  jti: string;
}

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET as string, {
    expiresIn: '15m',
  });
}

export function signRefreshToken(
  payload: AuthTokenPayload
): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign(
    { ...payload, jti },
    process.env.REFRESH_TOKEN_SECRET as string,
    { expiresIn: '7d' }
  );
  return { token, jti };
}

/**
 * Verifies an access token and returns its claims, or throws AuthError.
 *
 * Signed with ACCESS_TOKEN_SECRET, so a refresh token — signed with a different secret —
 * never passes here. Every failure (expired, malformed, wrong signature, missing claims)
 * is the same AuthError, so a caller cannot tell a forged token from an expired one.
 *
 * `exp` is returned so a long-lived connection (a socket) can end when its credential does.
 */
export function verifyAccessToken(
  token: string
): AuthTokenPayload & { exp: number } {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string);
  } catch {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }

  const claims = decoded as Partial<AuthTokenPayload & { exp: number }>;
  if (
    typeof claims.sub !== 'string' ||
    typeof claims.role !== 'string' ||
    typeof claims.exp !== 'number'
  ) {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }
  return { sub: claims.sub, role: claims.role, exp: claims.exp };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(
      token,
      process.env.REFRESH_TOKEN_SECRET as string
    ) as RefreshTokenPayload;
  } catch {
    throw new AuthError(INVALID_REFRESH_TOKEN_MESSAGE);
  }
}

export async function deleteAllRefreshTokensForUser(
  ns: string,
  userId: string
): Promise<void> {
  const pattern = refreshTokenKey(ns, userId, '*');
  const keysToDelete: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100
    );
    keysToDelete.push(...keys);
    cursor = nextCursor;
  } while (cursor !== '0');

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}

export type RefreshTokenCheck = 'current' | 'foreign' | 'reused';

/**
 * Classifies a verified refresh token before a service rotates it.
 *
 * - `current`: its key is still stored — rotate it.
 * - `reused`: its key is gone, but it names an account this service owns. A token that
 *   was already rotated is being presented again, which is what a stolen token looks
 *   like, so every refresh token for that account is revoked here. The caller clears the
 *   cookies and refuses.
 * - `foreign`: its key is gone and it names no account of this service — it belongs to a
 *   different app (user, seller and admin tokens share one signing secret). Nothing is
 *   revoked, and the caller must leave the cookies alone: where the apps share a cookie
 *   jar (every app on localhost in development), clearing them would log the user out of
 *   the app the token actually came from.
 */
export async function checkRefreshToken(
  namespace: string,
  decoded: RefreshTokenPayload,
  accountExists: (id: string) => Promise<boolean>
): Promise<RefreshTokenCheck> {
  if (await redis.exists(refreshTokenKey(namespace, decoded.sub, decoded.jti))) {
    return 'current';
  }
  if (!(await accountExists(decoded.sub))) {
    return 'foreign';
  }
  await deleteAllRefreshTokensForUser(namespace, decoded.sub);
  return 'reused';
}
