import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import type { NextFunction, Request, Response } from 'express';

const ACCESS_TOKEN_SECRET = 'test-access-secret';

const fakeAdmin = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@test.com',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    admin: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        id === fakeAdmin.id ? fakeAdmin : null,
    },
  },
}));

function mockReqRes(token?: string) {
  const req = { cookies: { access_token: token } } as unknown as Request;
  const res = {} as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

function sign(role: string, sub: string) {
  return jwt.sign({ sub, role }, ACCESS_TOKEN_SECRET);
}

describe('isAdminAuthenticated', () => {
  // ACCESS_TOKEN_SECRET must be set before the module under test is loaded
  // (it throws at import time if unset), so it's imported dynamically here
  // instead of statically at the top of the file.
  let isAdminAuthenticated: typeof import('./is-admin-authenticated.js')['isAdminAuthenticated'];

  beforeAll(async () => {
    process.env.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;
    ({ isAdminAuthenticated } = await import('./is-admin-authenticated.js'));
  });

  it('calls next() and sets req.admin for a valid admin token', async () => {
    const { req, res, next } = mockReqRes(sign('ADMIN', fakeAdmin.id));
    await isAdminAuthenticated(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.admin).toEqual(fakeAdmin);
  });

  it('rejects a user-role token', async () => {
    const { req, res, next } = mockReqRes(sign('USER', 'user-1'));
    await expect(
      isAdminAuthenticated(req, res, next)
    ).rejects.toBeInstanceOf(AuthError);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a seller-role token', async () => {
    const { req, res, next } = mockReqRes(sign('SELLER', 'seller-1'));
    await expect(
      isAdminAuthenticated(req, res, next)
    ).rejects.toBeInstanceOf(AuthError);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when no access token is present', async () => {
    const { req, res, next } = mockReqRes();
    await expect(
      isAdminAuthenticated(req, res, next)
    ).rejects.toBeInstanceOf(AuthError);
    expect(next).not.toHaveBeenCalled();
  });
});
