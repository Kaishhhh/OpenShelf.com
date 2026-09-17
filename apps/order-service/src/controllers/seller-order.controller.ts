import { Request, Response } from 'express';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  legalSourcesFor,
  orderStatusUpdateSchema,
  sellerOrderListQuerySchema,
  type OrderStatus,
  type OrderStatusUpdateResponse,
  type SellerOrder,
  type SellerOrderPage,
} from '@openshelf/types';
import { parseOrThrow } from '../utils/cart.helper.js';
import { emitOrderStatusChanged } from '../utils/events.js';
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

const LOG = '[seller orders]';

/**
 * The shop every query below is scoped to. It comes from requireApprovedShop, which
 * resolved it from the authenticated seller — shopId is never read from the body, query
 * or params anywhere in this file.
 */
function requireShopId(req: Request): string {
  const shop = req.shop;
  if (!shop) {
    throw new ForbiddenError('Shop not found or not approved');
  }
  return shop.id;
}

function parseOrderId(raw: unknown): string {
  const id = String(raw ?? '');
  // Prisma raises P2023 on a malformed ObjectId, which would 500 and make a bad id
  // distinguishable from another shop's. Every "not yours / not there" is one 404.
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new NotFoundError(ORDER_NOT_FOUND_MESSAGE);
  }
  return id;
}

/**
 * What a shop may see of an order.
 *
 * The split and the payout state are included — it is the seller's money. The buyer is
 * reduced to a name. Not selected, on purpose: userId, the buyer's email, paymentId and
 * the PaymentIntent id (which links this buyer's orders at other shops), and
 * stripeTransferId. `items` is this order's relation, so no other shop's lines can
 * appear.
 */
const SELLER_ORDER_SELECT = {
  id: true,
  status: true,
  subtotal: true,
  platformFee: true,
  sellerAmount: true,
  transferStatus: true,
  stockShortfall: true,
  ...ORDER_TIMESTAMPS_SELECT,
  user: { select: { name: true } },
  payment: { select: { currency: true } },
  items: { select: ORDER_ITEM_SELECT },
} as const;

type SelectedSellerOrder = SelectedTimestamps & {
  id: string;
  status: SellerOrder['status'];
  subtotal: number;
  platformFee: number;
  sellerAmount: number;
  transferStatus: SellerOrder['transferStatus'];
  stockShortfall: boolean;
  user: { name: string };
  payment: { currency: string };
  items: SelectedItem[];
};

function toSellerOrder(
  {
    user,
    payment,
    items,
    createdAt,
    shippedAt,
    deliveredAt,
    cancelledAt,
    ...order
  }: SelectedSellerOrder,
  images: Map<string, string>
): SellerOrder {
  return {
    ...order,
    ...toIsoTimestamps({ createdAt, shippedAt, deliveredAt, cancelledAt }),
    currency: payment.currency,
    buyer: { name: user.name },
    items: withImages(items, images),
  };
}

async function findShopOrder(id: string, shopId: string) {
  return prisma.order.findFirst({
    where: { id, shopId },
    select: SELLER_ORDER_SELECT,
  });
}

/**
 * GET /order/seller/orders — this shop's orders.
 *
 * Orders with a stock shortfall sort first: the buyer has paid for something that was
 * not in stock, and that needs the seller's attention before anything else. The sort is
 * in the query, not applied to a page afterwards, so pagination stays consistent.
 */
export async function listShopOrders(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const { page, limit, status } = parseOrThrow(sellerOrderListQuerySchema, req.query);

  const where = { shopId, ...(status ? { status } : {}) };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ stockShortfall: 'desc' }, { createdAt: 'desc' }],
      select: SELLER_ORDER_SELECT,
    }),
    prisma.order.count({ where }),
  ]);

  const images = await imagesFor(orders.flatMap((order) => order.items));

  return res.status(200).json({
    orders: orders.map((order) => toSellerOrder(order, images)),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  } satisfies SellerOrderPage);
}

/** GET /order/seller/orders/:id — another shop's order 404s exactly like a missing one. */
export async function getShopOrder(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseOrderId(req.params.id);

  const order = await findShopOrder(id, shopId);
  if (!order) {
    throw new NotFoundError(ORDER_NOT_FOUND_MESSAGE);
  }

  return res.status(200).json(toSellerOrder(order, await imagesFor(order.items)));
}

const TIMESTAMP_FOR: Partial<
  Record<OrderStatus, 'shippedAt' | 'deliveredAt' | 'cancelledAt'>
> = {
  SHIPPED: 'shippedAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
};

/**
 * PATCH /order/seller/orders/:id/status — moves an order one legal step.
 *
 * The transition is a single compare-and-set: the update only matches an order of this
 * shop that is currently in a status the target may be reached from. Checking first and
 * writing second would let two requests (or a stale tab) both pass the check; here the
 * database decides, and at most one wins.
 *
 * When nothing matched, the order is re-read only to choose the answer: absent (or
 * another shop's) is a 404, present is a 400 naming where it is and where it was asked
 * to go.
 *
 * **CANCELLED does not refund.** Refunds are a separate slice. Cancelling a paid order
 * leaves the following undone, and the response marks it `refundRequired`:
 *   1. Refund the buyer this order's subtotal — a partial refund against the charge on
 *      the shared PaymentIntent, since other shops' orders were paid in the same charge.
 *   2. If transferStatus is SUCCEEDED, reverse the seller's transfer (sellerAmount) with
 *      a transfer reversal. If it is PENDING or FAILED, ensure it is never sent.
 *   3. Restock the items that were actually decremented — those without stockShortfall.
 *   4. Decide whether the platform keeps or returns its platformFee.
 */
export async function updateOrderStatus(req: Request, res: Response) {
  const shopId = requireShopId(req);
  const id = parseOrderId(req.params.id);
  const { status: target } = parseOrThrow(orderStatusUpdateSchema, req.body);

  // A target nothing can reach (PAID, PENDING) skips the write entirely and falls
  // through to the same named 400 as any other illegal move.
  const sources = legalSourcesFor(target);
  const timestamp = TIMESTAMP_FOR[target];
  const { count } =
    sources.length > 0 && timestamp
      ? await prisma.order.updateMany({
          where: { id, shopId, status: { in: sources } },
          data: { status: target, [timestamp]: new Date() },
        })
      : { count: 0 };

  const order = await findShopOrder(id, shopId);
  if (!order) {
    throw new NotFoundError(ORDER_NOT_FOUND_MESSAGE);
  }

  if (count === 0) {
    throw new ValidationError(
      `Cannot change order from ${order.status} to ${target}`,
      { currentStatus: order.status, attemptedStatus: target }
    );
  }

  // The buyer's id is read for the event only, and deliberately not through
  // SELLER_ORDER_SELECT — it must never reach the seller's response.
  const owner = await prisma.order.findFirst({
    where: { id, shopId },
    select: { userId: true },
  });
  if (owner) {
    void emitOrderStatusChanged({
      orderId: id,
      shopId,
      userId: owner.userId,
      status: target,
    });
  }

  const refundRequired = target === 'CANCELLED';
  if (refundRequired) {
    console.warn(
      `${LOG} order ${id} cancelled by shop ${shopId}: refund not implemented — buyer refund of ${order.subtotal} and transfer (${order.transferStatus}) need handling`
    );
  }

  return res.status(200).json({
    order: toSellerOrder(order, await imagesFor(order.items)),
    refundRequired,
  } satisfies OrderStatusUpdateResponse);
}
