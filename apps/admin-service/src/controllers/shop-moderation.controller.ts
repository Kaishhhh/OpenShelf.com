import { Request, Response } from 'express';
import { NotFoundError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { shopModerationQuerySchema, shopRejectSchema } from '@openshelf/types';
import { parseOrThrow } from '../utils/admin-auth.helper.js';

export async function listShops(req: Request, res: Response) {
  const { status, page, limit } = parseOrThrow(
    shopModerationQuerySchema,
    req.query
  );

  const where =
    status === 'pending'
      ? { isApproved: false }
      : status === 'approved'
      ? { isApproved: true }
      : {};

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
    data: { isApproved: true, rejectionReason: null },
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
    data: { isApproved: false, rejectionReason: reason ?? null },
  });

  return res.status(200).json(updated);
}
