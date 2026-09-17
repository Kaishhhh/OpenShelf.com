interface Account {
  id: string;
  fcmTokens: string[];
}

let users: Account[] = [];
let sellers: Account[] = [];

function model(get: () => Account[]) {
  return {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(get().find((a) => a.id === where.id) ?? null),
    findMany: ({ where }: { where: { fcmTokens: { has: string } } }) =>
      Promise.resolve(get().filter((a) => a.fcmTokens.includes(where.fcmTokens.has))),
    update: ({ where, data }: { where: { id: string }; data: { fcmTokens: { set: string[] } } }) => {
      const account = get().find((a) => a.id === where.id) as Account;
      account.fcmTokens = data.fcmTokens.set;
      return Promise.resolve(account);
    },
  };
}

jest.mock('@openshelf/prisma', () => ({
  prisma: { user: model(() => users), seller: model(() => sellers) },
}));

import { MAX_FCM_TOKENS, registerToken, removeTokens } from './fcm-tokens.js';

beforeEach(() => {
  users = [
    { id: 'buyer-1', fcmTokens: ['old'] },
    { id: 'buyer-2', fcmTokens: ['shared-browser'] },
  ];
  sellers = [{ id: 'seller-1', fcmTokens: [] }];
});

describe('registerToken', () => {
  it('adds a new token', async () => {
    await registerToken('USER', 'buyer-1', 'new');
    expect(users[0].fcmTokens).toEqual(['old', 'new']);
  });

  it('does not duplicate a token already registered, and moves it to newest', async () => {
    users[0].fcmTokens = ['a', 'b'];
    await registerToken('USER', 'buyer-1', 'a');
    expect(users[0].fcmTokens).toEqual(['b', 'a']);
  });

  // One browser, logged out of a buyer account and into a seller account.
  it('takes the token away from every other account, across buyers and sellers', async () => {
    await registerToken('SELLER', 'seller-1', 'shared-browser');
    expect(users[1].fcmTokens).toEqual([]);
    expect(sellers[0].fcmTokens).toEqual(['shared-browser']);
  });

  it('keeps only the newest tokens', async () => {
    users[0].fcmTokens = Array.from({ length: MAX_FCM_TOKENS }, (_, i) => `t${i}`);
    await registerToken('USER', 'buyer-1', 'newest');
    expect(users[0].fcmTokens).toHaveLength(MAX_FCM_TOKENS);
    expect(users[0].fcmTokens[0]).toBe('t1');
    expect(users[0].fcmTokens.at(-1)).toBe('newest');
  });
});

describe('removeTokens', () => {
  it('removes only the named tokens from only that account', async () => {
    users[0].fcmTokens = ['keep', 'dead-1', 'dead-2'];
    await removeTokens('USER', 'buyer-1', ['dead-1', 'dead-2', 'unknown']);
    expect(users[0].fcmTokens).toEqual(['keep']);
    expect(users[1].fcmTokens).toEqual(['shared-browser']);
  });
});
