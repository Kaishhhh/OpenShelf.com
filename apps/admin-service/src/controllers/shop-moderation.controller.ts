import { Request, Response } from 'express';
import { NotFoundError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  shopModerationQuerySchema,
  shopRejectSchema,
  type ShopStatus,
} from '@openshelf/types';
import { parseOrThrow } from '../utils/admin-auth.helper.js';

export async function listShops(req: Request, res: Response) {
  const { status, page, limit } = parseOrThrow(
    shopModerationQuerySchema,
    req.query
  );

  // The query takes lowercase names; ShopStatus is uppercase. 'all' is the
  // only value that is not a status, so it is the only special case.
  const where =
    status === 'all'
      ? {}
      : { status: status.toUpperCase() as ShopStatus };

  const [shops, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: { seller: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.shop.count({ where }),
  ]);

  return res.status(200).json({
    shops,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}

export async function approveShop(req: Request, res: Response) {
  const id = String(req.params.id);
  const shop = await prisma.shop.findUnique({ where: { id } });
  if (!shop) {
    throw new NotFoundError('Shop not found');
  }

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    // Clearing the reason keeps a re-approved shop from carrying the note
    // that explained an earlier rejection.
    data: { status: 'APPROVED', rejectionReason: null },
  });

  return res.status(200).json(updated);
}

export async function rejectShop(req: Request, res: Response) {
  const { reason } = parseOrThrow(shopRejectSchema, req.body ?? {});

  const id = String(req.params.id);
  const shop = await prisma.shop.findUnique({ where: { id } });
  if (!shop) {
    throw new NotFoundError('Shop not found');
  }

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: { status: 'REJECTED', rejectionReason: reason ?? null },
  });

  return res.status(200).json(updated);
}
