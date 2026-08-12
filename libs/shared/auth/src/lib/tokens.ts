import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import { redis } from '@openshelf/redis';
import { refreshTokenKey } from './keys.js';
import { INVALID_REFRESH_TOKEN_MESSAGE } from './messages.js';

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
