import type { Admin, Seller, Shop, User } from '@prisma/client';

export type AuthenticatedUser = Omit<User, 'password'>;
export type AuthenticatedSeller = Omit<Seller, 'password'>;
export type AuthenticatedAdmin = Omit<Admin, 'password'>;

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      seller?: AuthenticatedSeller;
      admin?: AuthenticatedAdmin;
      shop?: Shop;
    }
  }
}
