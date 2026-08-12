import { randomInt } from 'crypto';
import { RateLimitError, ValidationError } from '@openshelf/errors';
import { redis } from '@openshelf/redis';
import {
  ATTEMPTS_TTL_SECONDS,
  COOLDOWN_TTL_SECONDS,
  LOCK_TTL_SECONDS,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_SECONDS,
  otpAttemptsKey,
  otpCooldownKey,
  otpKey,
  otpLockKey,
  pendingRegKey,
} from './keys.js';
import { CODE_INVALID_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from './messages.js';

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export async function issueOtp<T>(
  ns: string,
  email: string,
  payload: T
): Promise<string> {
  const otp = generateOtp();

  await redis
    .pipeline()
    .set(otpKey(ns, email), otp, 'EX', OTP_TTL_SECONDS)
    .set(
      pendingRegKey(ns, email),
      JSON.stringify(payload),
      'EX',
      OTP_TTL_SECONDS
    )
    .set(otpCooldownKey(ns, email), '1', 'EX', COOLDOWN_TTL_SECONDS)
    .exec();

  return otp;
}

export async function consumeOtp<T>(
  ns: string,
  email: string,
  otp: string
): Promise<T> {
  if (await redis.exists(otpLockKey(ns, email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  const storedOtp = await redis.get(otpKey(ns, email));
  if (!storedOtp) {
    throw new ValidationError(CODE_INVALID_MESSAGE);
  }

  if (storedOtp !== otp) {
    const attempts = await redis.incr(otpAttemptsKey(ns, email));
    if (attempts === 1) {
      await redis.expire(otpAttemptsKey(ns, email), ATTEMPTS_TTL_SECONDS);
    }
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await redis.set(otpLockKey(ns, email), '1', 'EX', LOCK_TTL_SECONDS);
      throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
    }
    throw new ValidationError(CODE_INVALID_MESSAGE);
  }

  const pendingRaw = await redis.get(pendingRegKey(ns, email));
  if (!pendingRaw) {
    throw new ValidationError(CODE_INVALID_MESSAGE);
  }

  await redis.del(
    otpKey(ns, email),
    pendingRegKey(ns, email),
    otpAttemptsKey(ns, email)
  );

  return JSON.parse(pendingRaw) as T;
}
