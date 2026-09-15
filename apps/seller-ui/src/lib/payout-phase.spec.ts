import type { StripeStatus } from './api';
import { payoutPhase, type PayoutPhase } from './payout-phase';

function status(overrides: Partial<StripeStatus>): StripeStatus {
  return {
    connected: true,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    ...overrides,
  };
}

describe('payoutPhase', () => {
  it.each<[string, Partial<StripeStatus>, PayoutPhase]>([
    ['no account', { connected: false }, 'not-connected'],
    ['account, form not finished', {}, 'incomplete'],
    ['form finished, Stripe still verifying', { detailsSubmitted: true }, 'verifying'],
    ['charges on, payouts not yet', { detailsSubmitted: true, chargesEnabled: true }, 'payouts-pending'],
    ['both on', { detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }, 'active'],
  ])('%s -> %s', (_label, overrides, expected) => {
    expect(payoutPhase(status(overrides))).toBe(expected);
  });

  // The case Stripe produces constantly: the seller is sent back having
  // submitted everything, and nothing is enabled yet.
  it('never treats submitted details alone as able to take payments', () => {
    const phase = payoutPhase(status({ detailsSubmitted: true }));
    expect(phase).not.toBe('active');
    expect(phase).not.toBe('payouts-pending');
  });

  it('ignores stale flags on a seller with no account', () => {
    expect(
      payoutPhase(status({ connected: false, chargesEnabled: true, payoutsEnabled: true }))
    ).toBe('not-connected');
  });
});
