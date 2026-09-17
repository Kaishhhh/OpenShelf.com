import { Request, Response } from 'express';
import { NotFoundError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  orderListQuerySchema,
  type BuyerOrder,
  type OrderPage,
} from '@openshelf/types';
import { parseOrThrow, requireUserId } from '../utils/cart.helper.js';

export const ORDER_NOT_FOUND_MESSAGE = 'Order not found';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * What a buyer may see of their order. Projected explicitly: platformFee, sellerAmount,
 * stripeTransferId and transferStatus describe how OpenShelf and the seller split the
 * money, and are never part of this.
 */
const BUYER_ORDER_SELECT = {
  id: true,
  status: true,
  subtotal: true,
  stockShortfall: true,
  createdAt: true,
  shop: { select: { id: true, name: true } },
  payment: { select: { stripePaymentIntentId: true, currency: true } },
  items: {
    select: {
      id: true,
      productId: true,
      title: true,
      price: true,
      quantity: true,
      lineTotal: true,
      stockShortfall: true,
    },
  },
} as const;

type SelectedOrder = {
  id: string;
  status: BuyerOrder['status'];
  subtotal: number;
  stockShortfall: boolean;
  createdAt: Date;
  shop: { id: string; name: string };
  payment: { stripePaymentIntentId: string; currency: string };
  items: BuyerOrder['items'];
};

function toBuyerOrder({ payment, createdAt, ...order }: SelectedOrder): BuyerOrder {
  return {
    ...order,
    createdAt: createdAt.toISOString(),
    paymentIntentId: payment.stripePaymentIntentId,
    currency: payment.currency,
  };
}

/**
 * GET /order/orders — the buyer's orders, newest first.
 *
 * userId comes from the session and is in every `where`; nothing in the query can widen
 * it. `paymentIntentId` only narrows within the buyer's own orders, so polling on
 * another buyer's intent id returns an empty page, not their orders.
 */
export async function listOrders(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { page, limit, paymentIntentId } = parseOrThrow(
    orderListQuerySchema,
    req.query
  );

  const where = {
    userId,
    ...(paymentIntentId
      ? { payment: { is: { stripePaymentIntentId: paymentIntentId } } }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: BUYER_ORDER_SELECT,
    }),
    prisma.order.count({ where }),
  ]);

  return res.status(200).json({
    orders: orders.map(toBuyerOrder),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  } satisfies OrderPage);
}

/**
 * GET /order/orders/:id.
 *
 * findFirst on id *and* userId, so another buyer's order is indistinguishable from one
 * that does not exist — a uniform 404, never a 403 that would confirm the id.
 */
export async function getOrder(req: Request, res: Response) {
  const userId = requireUserId(req);
  const id = String(req.params.id ?? '');
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new NotFoundError(ORDER_NOT_FOUND_MESSAGE);
  }

  const order = await prisma.order.findFirst({
    where: { id, userId },
    select: BUYER_ORDER_SELECT,
  });
  if (!order) {
    throw new NotFoundError(ORDER_NOT_FOUND_MESSAGE);
  }

  return res.status(200).json(toBuyerOrder(order));
}
