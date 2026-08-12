import {
  loginAttemptsKey,
  loginLockKey,
  otpAttemptsKey,
  otpCooldownKey,
  otpKey,
  otpLockKey,
  pendingRegKey,
  refreshTokenKey,
} from './keys.js';

describe('namespaced key builders', () => {
  const cases: Array<
    [string, (ns: string, email: string) => string, string]
  > = [
    ['otpKey', otpKey, 'otp'],
    ['pendingRegKey', pendingRegKey, 'pending_reg'],
    ['otpCooldownKey', otpCooldownKey, 'otp_cooldown'],
    ['otpLockKey', otpLockKey, 'otp_lock'],
    ['otpAttemptsKey', otpAttemptsKey, 'otp_attempts'],
    ['loginAttemptsKey', loginAttemptsKey, 'login_attempts'],
    ['loginLockKey', loginLockKey, 'login_lock'],
  ];

  it.each(cases)(
    '%s produces prefix:ns:email and keeps namespaces separate',
    (_name, fn, prefix) => {
      expect(fn('user', 'a@example.com')).toBe(`${prefix}:user:a@example.com`);
      expect(fn('seller', 'a@example.com')).toBe(
        `${prefix}:seller:a@example.com`
      );
      expect(fn('user', 'a@example.com')).not.toBe(
        fn('seller', 'a@example.com')
      );
    }
  );

  it('refreshTokenKey namespaces by ns, userId, and jti', () => {
    expect(refreshTokenKey('user', 'u1', 'j1')).toBe('refresh:user:u1:j1');
    expect(refreshTokenKey('seller', 'u1', 'j1')).toBe('refresh:seller:u1:j1');
    expect(refreshTokenKey('user', 'u1', 'j1')).not.toBe(
      refreshTokenKey('seller', 'u1', 'j1')
    );
  });
});
