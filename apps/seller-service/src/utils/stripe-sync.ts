import { prisma } from '@openshelf/prisma';
import type { PayoutStatus } from '@openshelf/stripe';

/**
 * Writes a connected account's charges and payouts state onto the seller that
 * owns it, and reports whether anything changed.
 *
 * The filter only matches a seller whose stored flags differ from `status`. So
 * applying the same state twice — a retried or replayed webhook, or a status
 * read landing after the webhook already did — matches nothing, writes nothing,
 * and leaves updatedAt alone.
 *
 * Callers must pass state they have just fetched from Stripe, never the
 * snapshot inside an event. Events arrive out of order, and writing an older
 * snapshot after a newer one would roll the flags back. A fresh fetch can only
 * ever write the account's current state.
 */
export async function syncSellerStripeStatus(
  accountId: string,
  status: Pick<PayoutStatus, 'chargesEnabled' | 'payoutsEnabled'>
): Promise<boolean> {
  const { count } = await prisma.seller.updateMany({
    where: {
      stripeId: accountId,
      OR: [
        { stripeChargesEnabled: { not: status.chargesEnabled } },
        { stripePayoutsEnabled: { not: status.payoutsEnabled } },
      ],
    },
    data: {
      stripeChargesEnabled: status.chargesEnabled,
      stripePayoutsEnabled: status.payoutsEnabled,
    },
  });

  return count > 0;
}
