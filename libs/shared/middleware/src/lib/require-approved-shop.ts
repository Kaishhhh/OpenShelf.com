import { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';

export async function requireApprovedShop(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const seller = req.seller;
  if (!seller) {
    throw new ForbiddenError('Not authenticated as a seller');
  }

  const shop = await prisma.shop.findUnique({
    where: { sellerId: seller.id },
  });

  if (!shop || !shop.isApproved) {
    throw new ForbiddenError('Shop not found or not approved');
  }

  req.shop = shop;
  next();
}
