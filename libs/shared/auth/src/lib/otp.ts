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
import {
  CODE_INVALID_MESSAGE,
  COOLDOWN_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
} from './messages.js';

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * Throws when too many wrong codes have locked this address out.
 *
 * Separate from the cooldown check because the two are answered differently:
 * register rejects both with a 429, while resend-otp must absorb a cooldown
 * silently and only surface the lock. See assertCanIssueOtp.
 */
export async function assertNotOtpLocked(
  ns: string,
  email: string
): Promise<void> {
  if (await redis.exists(otpLockKey(ns, email))) {
    throw new RateLimitError(TOO_MANY_ATTEMPTS_MESSAGE);
  }
}

/** Whether the 60s cooldown is still running. Asking is not an error. */
export async function isOtpCoolingDown(
  ns: string,
  email: string
): Promise<boolean> {
  return (await redis.exists(otpCooldownKey(ns, email))) === 1;
}

/**
 * The guard register uses: refuse a code while cooling down, and while locked.
 *
 * resend-otp deliberately does not use this — it treats the cooldown as a reason to
 * stay quiet rather than a reason to answer differently.
 */
export async function assertCanIssueOtp(
  ns: string,
  email: string
): Promise<void> {
  if (await isOtpCoolingDown(ns, email)) {
    throw new RateLimitError(COOLDOWN_MESSAGE);
  }
  await assertNotOtpLocked(ns, email);
}

/**
 * Reads the pending registration without consuming it.
 *
 * consumeOtp is the only other reader and it always deletes, so resending a code needs
 * this to get the payload back before handing it to issueOtp again.
 */
export async function getPendingRegistration<T>(
  ns: string,
  email: string
): Promise<T | null> {
  const raw = await redis.get(pendingRegKey(ns, email));
  return raw ? (JSON.parse(raw) as T) : null;
}

/**
 * Clears the wrong-code counter.
 *
 * A newly issued code deserves a fresh allowance: without this, attempts spent against
 * a code the user never received would still count toward locking them out.
 */
export async function clearOtpAttempts(
  ns: string,
  email: string
): Promise<void> {
  await redis.del(otpAttemptsKey(ns, email));
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
