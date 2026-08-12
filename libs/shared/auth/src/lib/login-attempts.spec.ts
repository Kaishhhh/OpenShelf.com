import { AuthError, RateLimitError } from '@openshelf/errors';

const store = new Map<string, string>();

function resetStore() {
  store.clear();
}

jest.mock('@openshelf/redis', () => {
  const fakeRedis = {
    get: async (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    del: async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    },
    exists: async (key: string) => (store.has(key) ? 1 : 0),
    incr: async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    },
    expire: async () => 1,
  };
  return { redis: fakeRedis };
});

import { MAX_LOGIN_ATTEMPTS, loginAttemptsKey, loginLockKey } from './keys.js';
import { checkAndBumpLoginAttempts, clearLoginAttempts } from './login-attempts.js';

describe('checkAndBumpLoginAttempts lockout threshold', () => {
  beforeEach(resetStore);

  it('throws AuthError for attempts below the threshold', async () => {
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
      await expect(
        checkAndBumpLoginAttempts('user', 'a@example.com')
      ).rejects.toBeInstanceOf(AuthError);
    }
    expect(store.get(loginLockKey('user', 'a@example.com'))).toBeUndefined();
  });

  it('locks out and throws RateLimitError once MAX_LOGIN_ATTEMPTS is reached', async () => {
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS - 1; i++) {
      await expect(
        checkAndBumpLoginAttempts('user', 'a@example.com')
      ).rejects.toBeInstanceOf(AuthError);
    }

    await expect(
      checkAndBumpLoginAttempts('user', 'a@example.com')
    ).rejects.toBeInstanceOf(RateLimitError);

    expect(store.get(loginLockKey('user', 'a@example.com'))).toBe('1');
  });

  it('keeps user and seller namespaces independent', async () => {
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      await expect(
        checkAndBumpLoginAttempts('user', 'shared@example.com')
      ).rejects.toBeInstanceOf(Error);
    }

    // The user namespace is now locked, but seller's counter is untouched.
    expect(store.get(loginLockKey('seller', 'shared@example.com'))).toBeUndefined();
    await expect(
      checkAndBumpLoginAttempts('seller', 'shared@example.com')
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('clearLoginAttempts', () => {
  beforeEach(resetStore);

  it('resets the counter so a subsequent failure starts from zero', async () => {
    await expect(
      checkAndBumpLoginAttempts('user', 'a@example.com')
    ).rejects.toBeInstanceOf(AuthError);
    expect(store.get(loginAttemptsKey('user', 'a@example.com'))).toBe('1');

    await clearLoginAttempts('user', 'a@example.com');
    expect(store.has(loginAttemptsKey('user', 'a@example.com'))).toBe(false);

    await expect(
      checkAndBumpLoginAttempts('user', 'a@example.com')
    ).rejects.toBeInstanceOf(AuthError);
    expect(store.get(loginAttemptsKey('user', 'a@example.com'))).toBe('1');
  });
});
