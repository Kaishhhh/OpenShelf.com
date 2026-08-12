import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';

if (!process.env.ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET is not set');
}

const NOT_AUTHENTICATED_MESSAGE = 'Not authenticated';
const SELLER_ROLE = 'SELLER';

interface AccessTokenPayload {
  sub: string;
  role: string;
}

export async function isSellerAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.access_token;
  if (!token) {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }

  let decoded: AccessTokenPayload;
  try {
    decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET as string
    ) as AccessTokenPayload;
  } catch {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }

  if (decoded.role !== SELLER_ROLE) {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }

  const seller = await prisma.seller.findUnique({
    where: { id: decoded.sub },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      country: true,
      stripeId: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!seller) {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }

  req.seller = seller;
  next();
}
