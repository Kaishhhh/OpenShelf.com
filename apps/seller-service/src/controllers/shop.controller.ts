import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthError, NotFoundError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { shopCreateSchema } from '@openshelf/types';
import { parseOrThrow } from '../utils/seller-auth.helper.js';

const ALREADY_HAS_SHOP_MESSAGE = 'You already have a shop';

export async function createShop(req: Request, res: Response) {
  const seller = req.seller;
  if (!seller) {
    throw new AuthError('Not authenticated');
  }

  const data = parseOrThrow(shopCreateSchema, req.body);

  const existingShop = await prisma.shop.findUnique({
    where: { sellerId: seller.id },
  });

  if (existingShop) {
    // A rejected shop is the seller's to fix and resubmit. A pending one is
    // waiting on an admin and an approved one is live — neither is theirs to
    // overwrite, so both keep the original error.
    if (existingShop.status !== 'REJECTED') {
      throw new ValidationError(ALREADY_HAS_SHOP_MESSAGE);
    }

    const resubmitted = await prisma.shop.update({
      where: { id: existingShop.id },
      data: {
        ...data,
        // Prisma reads `undefined` as "leave unchanged", so an optional the
        // seller cleared on resubmission would silently keep its old value.
        // Spell the clearing out instead.
        bio: data.bio ?? null,
        openingHours: data.openingHours ?? null,
        website: data.website ?? null,
        socialLinks: data.socialLinks ?? null,
        // Back into the queue, and the old reason no longer applies.
        status: 'PENDING',
        rejectionReason: null,
      },
    });

    // 200 rather than 201: this updated a shop that already existed.
    return res.status(200).json(resubmitted);
  }

  let shop;
  try {
    shop = await prisma.shop.create({
      data: { ...data, sellerId: seller.id },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ValidationError(ALREADY_HAS_SHOP_MESSAGE);
    }
    throw err;
  }

  return res.status(201).json(shop);
}

export async function getShop(req: Request, res: Response) {
  const seller = req.seller;
  if (!seller) {
    throw new AuthError('Not authenticated');
  }

  const shop = await prisma.shop.findUnique({
    where: { sellerId: seller.id },
  });
  if (!shop) {
    throw new NotFoundError('Shop not found');
  }

  return res.status(200).json(shop);
}
