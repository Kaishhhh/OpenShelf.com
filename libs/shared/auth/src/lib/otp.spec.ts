import { RateLimitError, ValidationError } from '@openshelf/errors';

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
    pipeline: () => {
      const ops: Array<() => void> = [];
      const chain = {
        set: (key: string, value: string) => {
          ops.push(() => store.set(key, value));
          return chain;
        },
        exec: async () => {
          ops.forEach((op) => op());
          return [];
        },
      };
      return chain;
    },
  };
  return { redis: fakeRedis };
});

import { MAX_OTP_ATTEMPTS } from './keys.js';
import { consumeOtp, generateOtp, issueOtp } from './otp.js';

describe('generateOtp', () => {
  it('returns a 6-digit numeric string', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });
});

describe('consumeOtp lockout threshold', () => {
  beforeEach(resetStore);

  it('accepts the correct code and returns the pending payload', async () => {
    const code = await issueOtp('user', 'a@example.com', { hello: 'world' });
    const result = await consumeOtp<{ hello: string }>(
      'user',
      'a@example.com',
      code
    );
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws ValidationError on a wrong code below the threshold', async () => {
    await issueOtp('user', 'a@example.com', { hello: 'world' });
    await expect(
      consumeOtp('user', 'a@example.com', '000000')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('locks out after MAX_OTP_ATTEMPTS wrong codes and rejects further attempts even with the right code', async () => {
    const code = await issueOtp('user', 'a@example.com', { hello: 'world' });

    for (let i = 0; i < MAX_OTP_ATTEMPTS - 1; i++) {
      await expect(
        consumeOtp('user', 'a@example.com', '000000')
      ).rejects.toBeInstanceOf(ValidationError);
    }

    // The attempt that crosses the threshold locks the account.
    await expect(
      consumeOtp('user', 'a@example.com', '000000')
    ).rejects.toBeInstanceOf(RateLimitError);

    // Now locked out — even the correct code is rejected.
    await expect(
      consumeOtp('user', 'a@example.com', code)
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('keeps user and seller namespaces independent', async () => {
    const code = await issueOtp('user', 'shared@example.com', { a: 1 });

    await expect(
      consumeOtp('seller', 'shared@example.com', code)
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      consumeOtp('user', 'shared@example.com', code)
    ).resolves.toEqual({ a: 1 });
  });
});
