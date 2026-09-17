const BUYER = '6a799c56c5d2c32dd3ffcf6c';
const SELLER = '6aa815f1029187b933a0708d';

let users: string[] = [];
let sellers: string[] = [];

jest.mock('@openshelf/redis', () => ({ redis: {} }));
jest.mock('@openshelf/prisma', () => ({
  prisma: {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(users.includes(where.id) ? { id: where.id } : null),
    },
    seller: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(sellers.includes(where.id) ? { id: where.id } : null),
    },
  },
}));

import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import { signAccessToken, signRefreshToken } from '@openshelf/auth';
import { authenticateHandshake, roomFor } from './socket.js';

const cookieFor = (token: string) => `theme=dark; access_token=${token}; other=1`;

beforeEach(() => {
  users = [BUYER];
  sellers = [SELLER];
});

describe('authenticateHandshake', () => {
  it('identifies a buyer from the access_token cookie', async () => {
    const token = signAccessToken({ sub: BUYER, role: 'USER' });
    await expect(authenticateHandshake(cookieFor(token))).resolves.toEqual({
      role: 'USER',
      id: BUYER,
      exp: expect.any(Number),
    });
  });

  it('identifies a seller', async () => {
    const token = signAccessToken({ sub: SELLER, role: 'SELLER' });
    await expect(authenticateHandshake(cookieFor(token))).resolves.toMatchObject({
      role: 'SELLER',
      id: SELLER,
    });
  });

  it.each([
    ['no cookie header', () => undefined],
    ['a cookie header without access_token', () => 'theme=dark'],
    ['a garbage token', () => cookieFor('garbage')],
    ['a forged token', () => cookieFor(jwt.sign({ sub: BUYER, role: 'USER' }, 'forged', { expiresIn: '15m' }))],
    [
      'an expired token',
      () =>
        cookieFor(
          jwt.sign(
            { sub: BUYER, role: 'USER', exp: Math.floor(Date.now() / 1000) - 5 },
            process.env.ACCESS_TOKEN_SECRET as string
          )
        ),
    ],
    ['a refresh token', () => cookieFor(signRefreshToken({ sub: BUYER, role: 'USER' }).token)],
    ['an admin token', () => cookieFor(signAccessToken({ sub: BUYER, role: 'ADMIN' }))],
    // Right secret, wrong collection: a seller token naming a buyer's id.
    ['a seller token for a buyer id', () => cookieFor(signAccessToken({ sub: BUYER, role: 'SELLER' }))],
  ])('rejects %s', async (_label, header) => {
    await expect(authenticateHandshake(header())).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a valid token for a deleted account', async () => {
    const token = signAccessToken({ sub: SELLER, role: 'SELLER' });
    sellers = [];
    await expect(authenticateHandshake(cookieFor(token))).rejects.toBeInstanceOf(AuthError);
  });
});

describe('roomFor', () => {
  // The same ObjectId can never land a buyer in a seller's room or the reverse.
  it('namespaces buyer and seller rooms', () => {
    expect(roomFor('USER', 'x')).toBe('user:x');
    expect(roomFor('SELLER', 'x')).toBe('seller:x');
  });
});
