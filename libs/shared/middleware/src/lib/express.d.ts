import type { Seller, User } from '@prisma/client';

export type AuthenticatedUser = Omit<User, 'password'>;
export type AuthenticatedSeller = Omit<Seller, 'password'>;

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      seller?: AuthenticatedSeller;
    }
  }
}
