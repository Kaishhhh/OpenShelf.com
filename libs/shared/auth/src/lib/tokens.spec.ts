const stored = new Set<string>();
const deleted: string[][] = [];

jest.mock('@openshelf/redis', () => ({
  redis: {
    exists: async (key: string) => (stored.has(key) ? 1 : 0),
    scan: async (_cursor: string, _match: string, pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...stored].filter((k) => k.startsWith(prefix))];
    },
    del: async (...keys: string[]) => {
      deleted.push(keys);
      keys.forEach((k) => stored.delete(k));
      return keys.length;
    },
  },
}));

process.env.ACCESS_TOKEN_SECRET = 'access-secret-for-tests';
process.env.REFRESH_TOKEN_SECRET = 'refresh-secret-for-tests';

import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import { refreshTokenKey } from './keys.js';
import {
  checkRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './tokens.js';

describe('verifyAccessToken', () => {
  it('returns the claims of a valid access token, including its expiry', () => {
    const token = signAccessToken({ sub: 'seller-1', role: 'SELLER' });
    const claims = verifyAccessToken(token);
    expect(claims).toEqual({ sub: 'seller-1', role: 'SELLER', exp: expect.any(Number) });
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
  });

  it('rejects an expired token', () => {
    const token = jwt.sign(
      { sub: 'u', role: 'USER', exp: Math.floor(Date.now() / 1000) - 10 },
      'access-secret-for-tests'
    );
    expect(() => verifyAccessToken(token)).toThrow(AuthError);
  });

  it('rejects a token signed with another secret', () => {
    const token = jwt.sign({ sub: 'u', role: 'USER' }, 'someone-else', { expiresIn: '15m' });
    expect(() => verifyAccessToken(token)).toThrow(AuthError);
  });

  // Different secrets are the whole separation between the two token kinds.
  it('rejects a refresh token presented as an access token', () => {
    const { token } = signRefreshToken({ sub: 'u', role: 'USER' });
    expect(() => verifyAccessToken(token)).toThrow(AuthError);
  });

  it('rejects garbage and tokens missing claims', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow(AuthError);
    const noRole = jwt.sign({ sub: 'u' }, 'access-secret-for-tests', { expiresIn: '15m' });
    expect(() => verifyAccessToken(noRole)).toThrow(AuthError);
  });

  it('gives every failure the same message', () => {
    const messages = ['garbage', jwt.sign({ sub: 'u', role: 'USER' }, 'x')].map((t) => {
      try {
        verifyAccessToken(t);
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    });
    expect(new Set(messages)).toEqual(new Set(['Not authenticated']));
  });
});

describe('checkRefreshToken', () => {
  const SELLER = 'seller-1';
  const BUYER = 'buyer-1';

  beforeEach(() => {
    stored.clear();
    deleted.length = 0;
  });

  const issue = (namespace: string, sub: string, role: string) => {
    const { token, jti } = signRefreshToken({ sub, role });
    stored.add(refreshTokenKey(namespace, sub, jti));
    return verifyRefreshToken(token);
  };

  it('accepts a token whose key is stored', async () => {
    const decoded = issue('seller', SELLER, 'SELLER');
    await expect(checkRefreshToken('seller', decoded, async () => true)).resolves.toBe('current');
    expect(deleted).toHaveLength(0);
  });

  // A rotated token presented again by an account this service owns.
  it('revokes every token of the account on reuse', async () => {
    const decoded = issue('seller', SELLER, 'SELLER');
    issue('seller', SELLER, 'SELLER'); // another live session
    stored.delete(refreshTokenKey('seller', SELLER, decoded.jti)); // already rotated

    await expect(checkRefreshToken('seller', decoded, async (id) => id === SELLER)).resolves.toBe(
      'reused'
    );
    expect([...stored].filter((k) => k.includes(SELLER))).toEqual([]);
  });

  // The buyer's refresh cookie presented to seller-service, as happens when both apps share
  // a cookie jar. Revoking — or clearing cookies — would log the buyer out of user-ui.
  it("classifies another app's token as foreign and revokes nothing", async () => {
    const buyerToken = issue('user', BUYER, 'USER');

    await expect(
      checkRefreshToken('seller', buyerToken, async (id) => id === SELLER)
    ).resolves.toBe('foreign');
    expect(deleted).toHaveLength(0);
    expect(stored.has(refreshTokenKey('user', BUYER, buyerToken.jti))).toBe(true);
  });
});
