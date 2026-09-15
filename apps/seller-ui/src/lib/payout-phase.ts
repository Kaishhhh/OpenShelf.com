import type { StripeStatus } from './api';

export type PayoutPhase =
  | 'not-connected'
  | 'incomplete'
  | 'verifying'
  | 'payouts-pending'
  | 'active';

/**
 * Where a seller is in getting paid.
 *
 * chargesEnabled is checked before detailsSubmitted on purpose. Stripe often
 * sends a seller back having submitted everything while verification is still
 * running, so "details submitted" must never read as "done" — only the enabled
 * flags say that.
 */
export function payoutPhase(status: StripeStatus): PayoutPhase {
  if (!status.connected) {
    return 'not-connected';
  }
  if (status.chargesEnabled) {
    return status.payoutsEnabled ? 'active' : 'payouts-pending';
  }
  return status.detailsSubmitted ? 'verifying' : 'incomplete';
}
