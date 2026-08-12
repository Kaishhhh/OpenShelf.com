import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';

if (!process.env.ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET is not set');
}

const NOT_AUTHENTICATED_MESSAGE = 'Not authenticated';

interface AccessTokenPayload {
  sub: string;
  role: string;
}

export async function isAuthenticated(
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

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      emailVerified: true,
      role: true,
      following: true,
      fcmTokens: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new AuthError(NOT_AUTHENTICATED_MESSAGE);
  }

  req.user = user;
  next();
}
