import type { User } from '@prisma/client';

export type AuthenticatedUser = Omit<User, 'password'>;

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
