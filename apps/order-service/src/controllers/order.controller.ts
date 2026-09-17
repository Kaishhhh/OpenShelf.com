import { Request, Response } from 'express';
import { NotFoundError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  orderListQuerySchema,
  type BuyerOrder,
  type OrderPage,
} from '@openshelf/types';
import { parseOrThrow, requireUserId } from '../utils/cart.helper.js';
import {
  OBJECT_ID_PATTERN,
  ORDER_ITEM_SELECT,
  ORDER_NOT_FOUND_MESSAGE,
  ORDER_TIMESTAMPS_SELECT,
  imagesFor,
  toIsoTimestamps,
  withImages,
  type SelectedItem,
  type SelectedTimestamps,
} from '../utils/order.projection.js';

export { ORDER_NOT_FOUND_MESSAGE };

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
  ...ORDER_TIMESTAMPS_SELECT,
  shop: { select: { id: true, name: true } },
  payment: { select: { stripePaymentIntentId: true, currency: true } },
  items: { select: ORDER_ITEM_SELECT },
} as const;

type SelectedOrder = SelectedTimestamps & {
  id: string;
  status: BuyerOrder['status'];
  subtotal: number;
  stockShortfall: boolean;
  shop: { id: string; name: string };
  payment: { stripePaymentIntentId: string; currency: string };
  items: SelectedItem[];
};

function toBuyerOrder(
  {
    payment,
    items,
    createdAt,
    shippedAt,
    deliveredAt,
    cancelledAt,
    ...order
  }: SelectedOrder,
  images: Map<string, string>
): BuyerOrder {
  return {
    ...order,
    ...toIsoTimestamps({ createdAt, shippedAt, deliveredAt, cancelledAt }),
    paymentIntentId: payment.stripePaymentIntentId,
    currency: payment.currency,
    items: withImages(items, images),
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

  const images = await imagesFor(orders.flatMap((order) => order.items));

  return res.status(200).json({
    orders: orders.map((order) => toBuyerOrder(order, images)),
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

  return res.status(200).json(toBuyerOrder(order, await imagesFor(order.items)));
}
