import { Request, Response } from 'express';
import { AuthError, ValidationError } from '@openshelf/errors';
import type { AuthenticatedSeller } from '@openshelf/middleware';
import { prisma } from '@openshelf/prisma';
import {
  createOnboardingLink,
  createRecipientAccount,
  retrieveAccount,
  toPayoutStatus,
  verifyEventNotification,
} from '@openshelf/stripe';
import { syncSellerStripeStatus } from '../utils/stripe-sync.js';

// Read per request rather than at import, so it cannot be captured before
// dotenv has run.
function sellerUiUrl(): string {
  return process.env.SELLER_UI_URL || 'http://localhost:3001';
}

/**
 * Stripe refuses account creation for a country it cannot onboard, or for a
 * capability it will not grant there. Both are about the seller, so they
 * surface as a 400 carrying Stripe's explanation. Any other Stripe failure —
 * including the platform's own configuration being refused — stays a 500.
 *
 * Keyed on the field Stripe names as the problem, so a refusal about anything
 * else can never be passed off as the seller's fault.
 */
function isAccountRefusedForSeller(err: unknown): err is { message: string } {
  const e = err as { type?: unknown; param?: unknown } | null;
  return (
    e?.type === 'StripeInvalidRequestError' &&
    typeof e.param === 'string' &&
    (e.param.startsWith('identity.country') ||
      e.param.startsWith('configuration.recipient.capabilities'))
  );
}

/**
 * The seller's connected account id, creating the account if they have none.
 *
 * Two requests can both arrive with stripeId unset. Stripe's idempotency key
 * (see createRecipientAccount) hands both the same account, and the write below
 * only fills an empty stripeId — so whichever request loses reads back the
 * winner's id instead of overwriting it.
 */
async function ensureConnectedAccount(
  seller: AuthenticatedSeller
): Promise<string> {
  if (seller.stripeId) {
    return seller.stripeId;
  }

  let accountId: string;
  try {
    ({ id: accountId } = await createRecipientAccount({
      sellerId: seller.id,
      name: seller.name,
      email: seller.email,
      country: seller.country,
    }));
  } catch (err) {
    if (isAccountRefusedForSeller(err)) {
      throw new ValidationError(err.message);
    }
    throw err;
  }

  const { count } = await prisma.seller.updateMany({
    // A seller created before this field was written has no stripeId key at
    // all, which `null` alone does not match on MongoDB.
    where: {
      id: seller.id,
      OR: [{ stripeId: null }, { stripeId: { isSet: false } }],
    },
    data: { stripeId: accountId },
  });
  if (count > 0) {
    return accountId;
  }

  const stored = await prisma.seller.findUnique({
    where: { id: seller.id },
    select: { stripeId: true },
  });
  if (!stored?.stripeId) {
    throw new Error(
      `Seller ${seller.id} lost the stripeId write but has no stripeId stored`
    );
  }
  return stored.stripeId;
}

export async function startStripeOnboarding(req: Request, res: Response) {
  const seller = req.seller;
  if (!seller) {
    throw new AuthError('Not authenticated');
  }

  const accountId = await ensureConnectedAccount(seller);
  const url = await createOnboardingLink(accountId, {
    returnUrl: `${sellerUiUrl()}/dashboard?stripe=return`,
    refreshUrl: `${sellerUiUrl()}/dashboard?stripe=refresh`,
  });

  return res.status(200).json({ url });
}

export async function getStripeStatus(req: Request, res: Response) {
  const seller = req.seller;
  if (!seller) {
    throw new AuthError('Not authenticated');
  }

  if (!seller.stripeId) {
    return res.status(200).json({
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
  }

  // Read from Stripe rather than the Seller row, and written back while we have
  // it: a webhook that never arrived is corrected the next time the seller
  // opens their dashboard.
  const status = toPayoutStatus(await retrieveAccount(seller.stripeId));
  await syncSellerStripeStatus(seller.stripeId, status);

  return res.status(200).json({ connected: true, ...status });
}

/**
 * The connected account a notification is about, or null when it is not about
 * one.
 *
 * Every account notification — a capability status change, a requirements
 * change, the account itself updating — names the account as its related
 * object, and all of them are handled the same way: fetch the account, store
 * its current state. Matching on that rather than a list of event types means
 * an account event type Stripe adds later is acted on, not quietly ignored.
 */
function accountIdFrom(notification: {
  type: string;
  related_object?: { id: string; type: string } | null;
}): string | null {
  const related = notification.related_object;
  return notification.type.startsWith('v2.core.account') &&
    related?.type === 'v2.core.account'
    ? related.id
    : null;
}

/**
 * POST /api/stripe/webhook. Authenticated by Stripe's signature alone, so it
 * must be mounted with express.raw ahead of express.json — see main.ts.
 *
 * Stripe sends thin notifications here: an event type and the id of the object
 * it concerns, no object state. So there is no stale snapshot that could be
 * applied out of order, and a replay can only prompt another fetch of the
 * account's current state — which syncSellerStripeStatus then finds already
 * stored.
 *
 * Every verified notification is answered 2xx unless handling genuinely failed.
 * Stripe retries anything else for days, so a notification this service does
 * not act on, or an account it does not own, is acknowledged, not rejected.
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  if (req.body === undefined) {
    // express.raw skipped it: no body, or not sent as application/json.
    throw new ValidationError('Expected an application/json body');
  }
  if (!Buffer.isBuffer(req.body)) {
    // A parser ran before express.raw and the original bytes are gone. Every
    // signature check would fail, so fail as a server error, not a 400 that
    // looks like a forged request.
    throw new Error(
      'Stripe webhook body was parsed before verification; mount the route ahead of express.json()'
    );
  }

  const notification = verifyEventNotification(
    req.body,
    req.headers['stripe-signature']
  );
  if (!notification) {
    throw new ValidationError('Invalid Stripe signature');
  }

  const accountId = accountIdFrom(notification);
  if (!accountId) {
    return res.status(200).json({ received: true });
  }

  const seller = await prisma.seller.findFirst({
    where: { stripeId: accountId },
    select: { id: true },
  });
  if (!seller) {
    console.warn(
      `[stripe webhook] ${notification.id} ${notification.type} for unknown account ${accountId}, ignored`
    );
    return res.status(200).json({ received: true, applied: false });
  }

  const status = toPayoutStatus(await retrieveAccount(accountId));
  const applied = await syncSellerStripeStatus(accountId, status);

  console.log(
    `[stripe webhook] ${notification.id} ${notification.type} ${accountId} charges=${status.chargesEnabled} payouts=${status.payoutsEnabled} applied=${applied}`
  );

  return res.status(200).json({ received: true, applied });
}
