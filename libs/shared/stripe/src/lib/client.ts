import Stripe from 'stripe';

/** A v2 connected account (`v2.core.account`). */
export type StripeAccount = Awaited<
  ReturnType<Stripe['v2']['core']['accounts']['retrieve']>
>;

/** A verified thin event notification (`v2.core.event`). Carries no object state. */
export type StripeEventNotification = ReturnType<
  Stripe['parseEventNotification']
>;

type RequirementEntry = NonNullable<
  NonNullable<StripeAccount['requirements']>['entries']
>[number];

/**
 * The part of a connected account's state the platform acts on.
 *
 * Accounts are created with the recipient configuration: OpenShelf charges the
 * buyer and transfers each seller their share, so "can take money" means "can
 * receive transfers", not "can charge cards".
 */
export interface PayoutStatus {
  /**
   * The recipient `stripe_balance.stripe_transfers` capability is active — the
   * seller can receive funds from sales. What decides whether their products
   * can be bought.
   */
  chargesEnabled: boolean;
  /** The `stripe_balance.payouts` capability is active — Stripe can pay out to their bank. */
  payoutsEnabled: boolean;
  /**
   * Nothing is currently waiting on the seller: no requirement they owe is
   * currently or past due. v2 has no `details_submitted`; this is its
   * equivalent, and like it implies neither flag above — Stripe's own
   * verification can still be running.
   */
  detailsSubmitted: boolean;
}

export interface RecipientAccountInput {
  sellerId: string;
  name: string;
  email: string;
  /** ISO 3166-1 alpha-2 — the form Seller.country is already validated to. */
  country: string;
}

export interface OnboardingUrls {
  returnUrl: string;
  refreshUrl: string;
}

// v2 leaves these blocks out of an account unless they are asked for, and
// toPayoutStatus reads nothing else. Without them every flag would read false.
const ACCOUNT_INCLUDE = ['configuration.recipient', 'requirements'] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let client: Stripe | undefined;

/**
 * The configured client, built on first use rather than at import time.
 *
 * Same reasoning as @openshelf/imagekit and @openshelf/email: building it eagerly would stop
 * seller-service booting for anyone without a Stripe key, taking login and every shop route down
 * with it. Deferred, the service starts, and the first Stripe route fails loudly with the variable
 * named.
 *
 * maxNetworkRetries covers dropped connections and the responses Stripe marks retryable. Retrying
 * a POST is safe because the SDK gives every retried request an idempotency key. It does not cover
 * a v2 request colliding with an in-flight one on the same key — see createRecipientAccount.
 */
export function stripe(): Stripe {
  client ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    maxNetworkRetries: 2,
  });
  return client;
}

type AccountCreateParams = NonNullable<
  Parameters<Stripe['v2']['core']['accounts']['create']>[0]
>;

// Backoff for a create that collided with an in-flight request on the same key.
// The other request is typically well under a second from finishing.
const IN_FLIGHT_RETRY_DELAYS_MS = [250, 500, 1000];

/**
 * Stripe's answer to a v2 request that arrives while another with the same
 * idempotency key is still being processed: 409 idempotency_error. Its message
 * claims the parameters differ, but it is returned for identical parameters
 * too, and the SDK does not retry it. Observed in test mode, 2026-09-15.
 */
function isInFlightKeyConflict(err: unknown): boolean {
  const e = err as { statusCode?: unknown; code?: unknown } | null;
  return e?.statusCode === 409 && e.code === 'idempotency_error';
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Creates a v2 connected account for a seller, configured as a recipient with
 * the Express dashboard.
 *
 * The idempotency key is derived from the seller rather than generated per call, which is what
 * makes this safe to race: two onboarding requests that both saw no stripeId get the same account
 * back from Stripe instead of creating two. Beyond Stripe's key retention, the stripeId
 * seller-service has stored is what prevents a second account.
 *
 * The request that loses that race is refused while the winner is in flight (see
 * isInFlightKeyConflict), so it waits and asks again — the same key then returns the winner's
 * account. A real parameter mismatch looks identical and simply fails once the retries run out.
 *
 * Only `stripe_transfers` is requested. Payouts cannot be requested on a recipient configuration;
 * Stripe reports that capability on the account and toPayoutStatus reads it.
 *
 * sellerId goes into metadata so any account can be traced back to its seller from the Stripe
 * dashboard — including one whose id never made it into the database.
 */
export async function createRecipientAccount(
  input: RecipientAccountInput
): Promise<StripeAccount> {
  const params: AccountCreateParams = {
    contact_email: input.email,
    display_name: input.name,
    dashboard: 'express',
    identity: { country: input.country },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: { stripe_transfers: { requested: true } },
        },
      },
    },
    defaults: {
      responsibilities: {
        fees_collector: 'application_express',
        losses_collector: 'application',
      },
    },
    metadata: { sellerId: input.sellerId },
    include: [...ACCOUNT_INCLUDE],
  };
  const options = { idempotencyKey: `connect-account:${input.sellerId}` };

  for (let attempt = 0; ; attempt++) {
    try {
      return await stripe().v2.core.accounts.create(params, options);
    } catch (err) {
      if (
        !isInFlightKeyConflict(err) ||
        attempt >= IN_FLIGHT_RETRY_DELAYS_MS.length
      ) {
        throw err;
      }
      await sleep(IN_FLIGHT_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * A single-use link into Stripe's hosted onboarding for the recipient configuration.
 *
 * Only the url comes back. A link lasts minutes, so the one correct use is to redirect to it
 * straight away.
 *
 * Stripe sends the seller to returnUrl when they leave the flow — finished or not — and to
 * refreshUrl when the link can no longer be used. Neither means onboarding is complete; only the
 * account's own state says that.
 */
export async function createOnboardingLink(
  accountId: string,
  urls: OnboardingUrls
): Promise<string> {
  const link = await stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['recipient'],
        return_url: urls.returnUrl,
        refresh_url: urls.refreshUrl,
      },
    },
  });
  return link.url;
}

export function retrieveAccount(accountId: string): Promise<StripeAccount> {
  return stripe().v2.core.accounts.retrieve(accountId, {
    include: [...ACCOUNT_INCLUDE],
  });
}

// A requirement the seller has to act on now, as opposed to one Stripe is
// working through or one that only comes due later.
function isOwedBySeller(entry: RequirementEntry): boolean {
  const status = entry.minimum_deadline.status;
  return (
    entry.awaiting_action_from === 'user' &&
    (status === 'currently_due' || status === 'past_due')
  );
}

/**
 * Built field by field so that an account — which carries the seller's identity and bank details
 * — can never be spread into a response by accident. The specs assert the exact key set.
 *
 * Every missing block reads as "not yet". In particular an account fetched without its
 * requirements must not claim nothing is owed.
 */
export function toPayoutStatus(
  account: Pick<StripeAccount, 'configuration' | 'requirements'>
): PayoutStatus {
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  return {
    chargesEnabled: balance?.stripe_transfers?.status === 'active',
    payoutsEnabled: balance?.payouts?.status === 'active',
    detailsSubmitted:
      account.requirements !== undefined &&
      !(account.requirements.entries ?? []).some(isOwedBySeller),
  };
}

/**
 * Verifies a thin event notification's signature and parses it, or returns null when the
 * signature does not check out — missing, malformed, stale, or not made with our secret.
 *
 * rawBody must be the exact bytes Stripe sent. The signature is an HMAC over them, so a body that
 * was parsed and re-serialised fails even when the JSON is equivalent.
 *
 * Throws, rather than returning null, when STRIPE_WEBHOOK_SECRET is unset — a broken deploy that
 * would otherwise read like a stream of forged requests — and when a correctly signed payload is
 * a v1 snapshot event, which means the Stripe event destination is misconfigured.
 *
 * parseEventNotification is an instance method, so this needs STRIPE_SECRET_KEY as well. Every
 * notification this service acts on is followed by an account fetch that needs it anyway.
 */
export function verifyEventNotification(
  rawBody: Buffer,
  signature: string | string[] | undefined
): StripeEventNotification | null {
  const secret = requireEnv('STRIPE_WEBHOOK_SECRET');

  // Express types a repeated header as an array. Stripe sends exactly one.
  if (typeof signature !== 'string' || signature === '') {
    return null;
  }

  try {
    return stripe().parseEventNotification(rawBody, signature, secret);
  } catch (err) {
    if (isSignatureError(err)) {
      return null;
    }
    throw err;
  }
}

// Matched on `type` rather than instanceof, which would miss an error thrown by a second copy of
// the SDK.
function isSignatureError(err: unknown): boolean {
  return (
    (err as { type?: unknown } | null)?.type ===
    'StripeSignatureVerificationError'
  );
}

// ---------------------------------------------------------------------------
// Payments. OpenShelf is merchant of record: the buyer is charged once on the
// platform account, and each seller's share moves afterwards as a transfer.
// ---------------------------------------------------------------------------

/** A v1 snapshot event (`payment_intent.*`), as delivered to order-service. */
export type StripeEvent = Stripe.Event;
export type StripePaymentIntent = Stripe.PaymentIntent;

export interface PaymentIntentInput {
  /** Minor units. */
  amount: number;
  currency: string;
  userId: string;
}

/**
 * A PaymentIntent for the whole cart, charged on the platform account.
 *
 * No `transfer_data` and no `on_behalf_of`: separate charges and transfers. The
 * seller split happens later, per order, once payment is confirmed. userId goes
 * into metadata so a charge in the dashboard traces back to its buyer.
 */
export function createPaymentIntent(
  input: PaymentIntentInput
): Promise<StripePaymentIntent> {
  return stripe().paymentIntents.create({
    amount: input.amount,
    currency: input.currency,
    automatic_payment_methods: { enabled: true },
    metadata: { userId: input.userId },
  });
}

export interface TransferInput {
  /** Minor units. */
  amount: number;
  currency: string;
  /** The seller's connected account id. */
  destination: string;
  /** The charge the funds came from. */
  sourceTransaction: string;
  /** Groups every transfer made from one PaymentIntent. */
  transferGroup: string;
  orderId: string;
}

/**
 * Moves one order's seller share to the seller's connected account.
 *
 * The idempotency key is derived from the order, so a retried webhook that reaches this again for
 * the same order gets the original transfer back rather than paying the seller twice.
 *
 * source_transaction ties the transfer to the charge's funds. Without it the transfer draws on the
 * platform's *available* balance, which a charge made seconds ago has not reached yet — every
 * transfer would fail with insufficient funds.
 */
export function createTransfer(input: TransferInput): Promise<Stripe.Transfer> {
  return stripe().transfers.create(
    {
      amount: input.amount,
      currency: input.currency,
      destination: input.destination,
      source_transaction: input.sourceTransaction,
      transfer_group: input.transferGroup,
      metadata: { orderId: input.orderId },
    },
    { idempotencyKey: `order-transfer:${input.orderId}` }
  );
}

/**
 * Verifies and parses a v1 snapshot event for the payments endpoint, or returns null when the
 * signature does not check out.
 *
 * A different secret from verifyEventNotification's: payment events come from their own event
 * destination (snapshot payloads), not the thin v2 destination seller-service listens on, and each
 * destination signs with its own secret. Same contract otherwise — rawBody must be the exact bytes,
 * and a missing secret throws rather than reading like a forged request.
 *
 * Static, so no secret key is needed just to check a signature.
 */
export function verifyWebhookEvent(
  rawBody: Buffer,
  signature: string | string[] | undefined
): StripeEvent | null {
  const secret = requireEnv('STRIPE_PAYMENTS_WEBHOOK_SECRET');

  if (typeof signature !== 'string' || signature === '') {
    return null;
  }

  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    if (isSignatureError(err)) {
      return null;
    }
    throw err;
  }
}
