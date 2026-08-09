import { Request, Response } from 'express';
import { RateLimitError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { redis } from '@openshelf/redis';
import {
  ATTEMPTS_TTL_SECONDS,
  COOLDOWN_TTL_SECONDS,
  LOCK_TTL_SECONDS,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_SECONDS,
  PendingRegistration,
  generateOtp,
  hashPassword,
  otpAttemptsKey,
  otpCooldownKey,
  otpKey,
  otpLockKey,
  parseOrThrow,
  pendingRegKey,
  registerSchema,
  verifyOtpSchema,
} from '../utils/auth.helper.js';

const REGISTER_SUCCESS_MESSAGE =
  'Verification code sent. Please check your email.';
const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many failed attempts, please try again later';
const CODE_INVALID_MESSAGE = 'Code expired or invalid';

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
