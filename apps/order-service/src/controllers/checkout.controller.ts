import { Request, Response } from 'express';
import { ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { createPaymentIntent } from '@openshelf/stripe';
import type { CheckoutResponse } from '@openshelf/types';
import { buildCart } from '../utils/cart.builder.js';
import { requireUserId } from '../utils/cart.helper.js';
import { readCart } from '../utils/cart.store.js';
import {
  CHECKOUT_CURRENCY,
  MIN_CHARGE_CENTS,
  lineTotal,
  toPricedLines,
} from '../utils/checkout.helper.js';

/**
 * POST /order/checkout — starts paying for the cart as it stands right now.
 *
 * Nothing in the request body is read. The total is recomputed from Redis and the
 * database, so a client cannot choose what it is charged.
 *
 * The PaymentIntent is created before the Payment row, because the row is keyed on its
 * id. That ordering is safe: payment_intent.succeeded cannot fire until the client
 * confirms, and the client cannot confirm without the secret this response returns — by
 * which point the row exists. A failure between the two leaves an intent nobody holds
 * the secret to, which simply expires unused.
 *
 * Stock is not reserved here. It is decremented when payment is confirmed, accepting a
 * rare oversell over holding inventory for abandoned carts.
 */
export async function startCheckout(req: Request, res: Response) {
  const userId = requireUserId(req);

  // buildCart applies every buyability rule — ACTIVE, APPROVED shop, charges-enabled
  // seller, stock — and prunes or clamps whatever fails one.
  const cart = await buildCart(userId, await readCart(userId));

  // Any notice means what the buyer last saw is no longer what they would be charged
  // for: something was removed, or a quantity no longer fits the stock. They review the
  // cart rather than paying for a different one.
  if (cart.notices.length > 0) {
    throw new ValidationError(
      'Your cart changed. Review it before checking out.',
      cart.notices
    );
  }

  const lines = toPricedLines(cart);
  if (lines.length === 0) {
    throw new ValidationError('Your cart is empty');
  }

  const amount = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  if (amount < MIN_CHARGE_CENTS) {
    throw new ValidationError(
      `The minimum order is $${(MIN_CHARGE_CENTS / 100).toFixed(2)}`
    );
  }

  const intent = await createPaymentIntent({
    amount,
    currency: CHECKOUT_CURRENCY,
    userId,
  });
  if (!intent.client_secret) {
    throw new Error(`PaymentIntent ${intent.id} was created without a client secret`);
  }

  // The lines are the contract with the webhook: orders are built from this snapshot,
  // never from the cart, which the buyer is free to change while paying.
  await prisma.payment.create({
    data: {
      userId,
      stripePaymentIntentId: intent.id,
      amount,
      currency: CHECKOUT_CURRENCY,
      status: 'PENDING',
      lines,
    },
  });

  return res.status(201).json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amount,
    currency: CHECKOUT_CURRENCY,
  } satisfies CheckoutResponse);
}
