import { Request, Response } from 'express';
import { Prisma, type Payment } from '@prisma/client';
import { ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import {
  createTransfer,
  verifyWebhookEvent,
  type StripePaymentIntent,
} from '@openshelf/stripe';
import { removeItems } from '../utils/cart.store.js';
import { emitOrderCreated } from '../utils/events.js';
import {
  computeSplit,
  lineTotal,
  splitByShop,
} from '../utils/checkout.helper.js';

const LOG = '[payments webhook]';

/**
 * Mongo aborts a transaction that touched a document another transaction committed a
 * change to, and Prisma surfaces that as P2034. Two concurrent deliveries of one event
 * both claim the same Payment document, so the loser lands here — and on retry finds the
 * payment already SUCCEEDED and does nothing.
 */
const MAX_WRITE_CONFLICT_RETRIES = 3;

/**
 * Generous: the fan-out is a few round trips per cart line to a remote Atlas cluster, and
 * Prisma's 5s default would abort a large cart that was doing nothing wrong.
 */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

function isWriteConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
  );
}

interface CreatedOrder {
  id: string;
  shopId: string;
  subtotal: number;
}

/**
 * Claims the payment and writes its orders, all or nothing. Returns the orders it wrote,
 * or null when another delivery already did.
 *
 * The claim is a conditional update on Payment.status. Inside a transaction, a second
 * delivery either sees SUCCEEDED and matches nothing, or races this one to the same
 * document and is aborted with a write conflict. Either way exactly one set of orders is
 * written. If anything below the claim throws, the claim rolls back with it, so Stripe's
 * retry starts clean.
 *
 * Stock is decremented per line with a conditional `stock >= quantity` update. Inside the
 * transaction it cannot interleave with another write to the same product — that is a
 * write conflict too — so it can never take stock below zero. A line that cannot be
 * decremented (sold out since checkout, or the product is gone) still becomes an order
 * item, because the buyer has paid for it; it is flagged instead, and stock is left
 * alone.
 */
async function fulfilPayment(payment: Payment): Promise<CreatedOrder[] | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: { not: 'SUCCEEDED' } },
          data: { status: 'SUCCEEDED' },
        });
        if (count === 0) {
          return null;
        }

        const created: CreatedOrder[] = [];
        for (const [shopId, lines] of splitByShop(payment.lines)) {
          const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];

          for (const line of lines) {
            const decremented = await tx.product.updateMany({
              where: { id: line.productId, stock: { gte: line.quantity } },
              data: { stock: { decrement: line.quantity } },
            });

            items.push({
              productId: line.productId,
              title: line.title,
              price: line.price,
              quantity: line.quantity,
              lineTotal: lineTotal(line),
              stockShortfall: decremented.count === 0,
            });
          }

          const order = await tx.order.create({
            select: { id: true, shopId: true, subtotal: true },
            data: {
              paymentId: payment.id,
              shopId,
              userId: payment.userId,
              status: 'PAID',
              ...computeSplit(lines),
              transferStatus: 'PENDING',
              stockShortfall: items.some((item) => item.stockShortfall),
              items: { create: items },
            },
          });
          created.push(order);
        }

        return created;
      }, TRANSACTION_OPTIONS);
    } catch (err) {
      if (!isWriteConflict(err) || attempt >= MAX_WRITE_CONFLICT_RETRIES) {
        throw err;
      }
    }
  }
}

/**
 * Takes what was bought out of the cart — only those lines. Anything the buyer added
 * after checkout started stays.
 *
 * Runs after the orders are committed, and only in the delivery that wrote them. A
 * failure here is logged rather than thrown: the orders exist, and a 500 would make
 * Stripe retry an event that has already been handled. A line left in the cart is
 * visible and harmless.
 */
async function removePaidLines(payment: Payment): Promise<void> {
  const productIds = [...new Set(payment.lines.map((line) => line.productId))];
  try {
    await removeItems(payment.userId, productIds);
  } catch (err) {
    console.error(
      `${LOG} payment ${payment.id}: orders written but paid lines were not removed from cart:${payment.userId}`,
      err
    );
  }
}

function chargeIdOf(intent: StripePaymentIntent): string | null {
  const charge = intent.latest_charge;
  if (!charge) {
    return null;
  }
  return typeof charge === 'string' ? charge : charge.id;
}

interface TransferOutcome {
  orderId: string;
  status: 'SUCCEEDED' | 'FAILED';
}

/**
 * One transfer per order still PENDING for this payment.
 *
 * Only PENDING orders are touched, so a replayed delivery finds nothing to do, and a
 * SUCCEEDED transfer is never attempted twice. PENDING orders are picked up on a retry,
 * which is what recovers a delivery that crashed after the orders committed; the
 * per-order idempotency key means even an attempt that did reach Stripe before the crash
 * returns the original transfer rather than paying the seller again.
 *
 * A failed transfer is recorded FAILED and the loop moves on. It is never re-attempted
 * automatically — failing the webhook for it would make Stripe redeliver indefinitely.
 */
async function transferPendingOrders(
  payment: Payment,
  intent: StripePaymentIntent
): Promise<TransferOutcome[]> {
  const orders = await prisma.order.findMany({
    where: { paymentId: payment.id, transferStatus: 'PENDING' },
    select: {
      id: true,
      sellerAmount: true,
      shop: { select: { seller: { select: { stripeId: true } } } },
    },
  });

  const chargeId = chargeIdOf(intent);
  const outcomes: TransferOutcome[] = [];

  for (const order of orders) {
    let transferId: string;
    try {
      if (!chargeId) {
        throw new Error(`PaymentIntent ${intent.id} has no charge to transfer from`);
      }
      const destination = order.shop.seller?.stripeId;
      if (!destination) {
        throw new Error('seller has no connected account');
      }

      const transfer = await createTransfer({
        amount: order.sellerAmount,
        currency: payment.currency,
        destination,
        sourceTransaction: chargeId,
        transferGroup: intent.id,
        orderId: order.id,
      });
      transferId = transfer.id;
    } catch (err) {
      console.error(`${LOG} transfer for order ${order.id} failed`, err);
      await prisma.order.updateMany({
        where: { id: order.id, transferStatus: 'PENDING' },
        data: { transferStatus: 'FAILED' },
      });
      outcomes.push({ orderId: order.id, status: 'FAILED' });
      continue;
    }

    // Deliberately outside the try above. If recording a transfer that did happen fails,
    // it must not be written down as FAILED — let it throw, the order stays PENDING, and
    // the retry gets the same transfer back from the idempotency key and records it.
    await prisma.order.updateMany({
      where: { id: order.id, transferStatus: 'PENDING' },
      data: { transferStatus: 'SUCCEEDED', stripeTransferId: transferId },
    });
    outcomes.push({ orderId: order.id, status: 'SUCCEEDED' });
  }

  return outcomes;
}

async function handlePaymentSucceeded(intent: StripePaymentIntent) {
  const payment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: intent.id },
  });
  if (!payment) {
    // An intent this service did not create — made in the dashboard, or by another
    // integration on the same account. Acknowledged so Stripe stops sending it.
    console.warn(`${LOG} ${intent.id} succeeded but has no Payment, ignored`);
    return { applied: false };
  }

  // The intent's amount is fixed by checkout and never updated, so a mismatch means
  // something outside this service changed it. Orders are not written against a charge
  // that disagrees with the lines; it needs a person, not a retry.
  if (
    intent.amount_received !== payment.amount ||
    intent.currency !== payment.currency
  ) {
    console.error(
      `${LOG} ${intent.id} received ${intent.amount_received} ${intent.currency} but Payment ${payment.id} expects ${payment.amount} ${payment.currency}; not fulfilled`
    );
    return { applied: false };
  }

  const created = await fulfilPayment(payment);
  const claimed = created !== null;
  if (created) {
    await removePaidLines(payment);

    // After the commit, and only from the delivery that wrote the orders — a replay has
    // nothing new to announce. Not awaited: the buyer has paid, and a broker outage must
    // not turn that into a failed webhook. See utils/events.ts.
    for (const order of created) {
      void emitOrderCreated({
        orderId: order.id,
        shopId: order.shopId,
        userId: payment.userId,
        status: 'PAID',
        subtotal: order.subtotal,
        currency: payment.currency,
      });
    }
  }

  const transfers = await transferPendingOrders(payment, intent);

  console.log(
    `${LOG} ${intent.id} payment=${payment.id} claimed=${claimed} transfers=${JSON.stringify(transfers)}`
  );
  return { applied: claimed, transfers };
}

/**
 * Not final: after a decline the buyer can confirm the same intent with another card, so
 * a later payment_intent.succeeded still claims a FAILED payment. Never downgrades a
 * SUCCEEDED one — events can arrive out of order.
 */
async function handlePaymentFailed(intent: StripePaymentIntent) {
  const { count } = await prisma.payment.updateMany({
    where: { stripePaymentIntentId: intent.id, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
  console.log(`${LOG} ${intent.id} payment_failed applied=${count > 0}`);
  return { applied: count > 0 };
}

/**
 * POST /order/webhook. Authenticated by Stripe's signature alone, so it is mounted with
 * express.raw ahead of express.json and ahead of every authenticated router — see
 * main.ts.
 *
 * Answers 2xx for every verified event it has handled or chosen to ignore, and only
 * fails when writing the orders themselves failed — the one case where a retry is wanted.
 */
export async function handlePaymentsWebhook(req: Request, res: Response) {
  if (req.body === undefined) {
    throw new ValidationError('Expected an application/json body');
  }
  if (!Buffer.isBuffer(req.body)) {
    throw new Error(
      'Stripe webhook body was parsed before verification; mount the route ahead of express.json()'
    );
  }

  const event = verifyWebhookEvent(req.body, req.headers['stripe-signature']);
  if (!event) {
    throw new ValidationError('Invalid Stripe signature');
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      return res
        .status(200)
        .json({ received: true, ...(await handlePaymentSucceeded(event.data.object)) });
    case 'payment_intent.payment_failed':
      return res
        .status(200)
        .json({ received: true, ...(await handlePaymentFailed(event.data.object)) });
    default:
      return res.status(200).json({ received: true });
  }
}
