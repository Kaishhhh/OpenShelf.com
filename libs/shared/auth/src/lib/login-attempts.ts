import { AuthError, RateLimitError } from '@openshelf/errors';
import { redis } from '@openshelf/redis';
import {
  LOGIN_ATTEMPTS_TTL_SECONDS,
  LOGIN_LOCK_TTL_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  loginAttemptsKey,
  loginLockKey,
} from './keys.js';
import { INVALID_CREDENTIALS_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from './messages.js';

export async function checkAndBumpLoginAttempts(
  ns: string,
  email: string
): Promise<void> {
  const attempts = await redis.incr(loginAttemptsKey(ns, email));
  if (attempts === 1) {
    await redis.expire(loginAttemptsKey(ns, email), LOGIN_ATTEMPTS_TTL_SECONDS);
  }
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    await redis.set(loginLockKey(ns, email), '1', 'EX', LOGIN_LOCK_TTL_SECONDS);
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }
  throw new AuthError(INVALID_CREDENTIALS_MESSAGE);
}

export async function clearLoginAttempts(
  ns: string,
  email: string
): Promise<void> {
  await redis.del(loginAttemptsKey(ns, email));
}
