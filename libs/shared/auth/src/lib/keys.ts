export const OTP_TTL_SECONDS = 300;
export const COOLDOWN_TTL_SECONDS = 60;
export const ATTEMPTS_TTL_SECONDS = 300;
export const LOCK_TTL_SECONDS = 1800;
export const MAX_OTP_ATTEMPTS = 5;

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPTS_TTL_SECONDS = 900;
export const LOGIN_LOCK_TTL_SECONDS = 900;

export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_TOKEN_MAX_AGE_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

export const otpKey = (ns: string, email: string) => `otp:${ns}:${email}`;

export const pendingRegKey = (ns: string, email: string) =>
  `pending_reg:${ns}:${email}`;

export const otpCooldownKey = (ns: string, email: string) =>
  `otp_cooldown:${ns}:${email}`;

export const otpLockKey = (ns: string, email: string) =>
  `otp_lock:${ns}:${email}`;

export const otpAttemptsKey = (ns: string, email: string) =>
  `otp_attempts:${ns}:${email}`;

export const loginAttemptsKey = (ns: string, email: string) =>
  `login_attempts:${ns}:${email}`;

export const loginLockKey = (ns: string, email: string) =>
  `login_lock:${ns}:${email}`;

export const refreshTokenKey = (ns: string, userId: string, jti: string) =>
  `refresh:${ns}:${userId}:${jti}`;
