import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Stripe.js, loaded once per page load and shared by every Elements tree.
 *
 * The publishable key is public by design — it can only create tokens and confirm
 * intents the server already made — so NEXT_PUBLIC_ is correct here, unlike the secret
 * key, which never leaves order-service.
 *
 * Null when the key is not configured, so the checkout page can say so plainly instead of
 * rendering a payment form that can never load.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null;
