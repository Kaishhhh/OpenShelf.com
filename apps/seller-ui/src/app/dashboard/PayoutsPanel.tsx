'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@openshelf/ui';
import {
  ApiError,
  getStripeStatus,
  startStripeOnboarding,
  type StripeStatus,
} from '@/lib/api';
import { payoutPhase, type PayoutPhase } from '@/lib/payout-phase';

// While Stripe verifies a seller who has submitted everything, re-read status
// so the panel flips to enabled without a reload.
const VERIFYING_POLL_MS = 10_000;

/**
 * Why the seller is on the dashboard, when Stripe sent them. seller-service
 * sets these as the Account Link's return_url and refresh_url.
 *
 * - return: they left Stripe's flow. Finished or not — only status says which.
 * - refresh: the link could not be used, almost always because it expired.
 */
type Arrival = 'return' | 'refresh' | null;

function readArrival(value: string | null): Arrival {
  return value === 'return' || value === 'refresh' ? value : null;
}

const BADGES: Record<PayoutPhase, { label: string; className: string }> = {
  'not-connected': { label: 'Not connected', className: 'border-line text-ink-muted' },
  incomplete: { label: 'Setup incomplete', className: 'border-line text-ink-muted' },
  verifying: { label: 'Verification pending', className: 'border-accent/40 text-accent' },
  'payouts-pending': { label: 'Payouts pending', className: 'border-accent/40 text-accent' },
  active: { label: 'Active', className: 'border-accent bg-accent text-surface' },
};

function Badge({ phase }: { phase: PayoutPhase }) {
  const { label, className } = BADGES[phase];
  return (
    <span className={`rounded-card border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink">{label}</span>
      <span className={enabled ? 'font-medium text-accent' : 'text-ink-muted'}>
        {enabled ? 'Enabled' : 'Pending'}
      </span>
    </div>
  );
}

export function PayoutsPanel({ shopApproved }: { shopApproved: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read once, then cleared from the URL below: a reload should not claim the
  // seller just came back from Stripe, but the message should outlive the
  // query string.
  const [arrival] = useState<Arrival>(() =>
    readArrival(searchParams.get('stripe'))
  );

  useEffect(() => {
    if (searchParams.get('stripe')) {
      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router]);

  const { data, error, isPending } = useQuery<StripeStatus, ApiError>({
    queryKey: ['stripe-status'],
    queryFn: getStripeStatus,
    refetchInterval: (query) =>
      query.state.data && payoutPhase(query.state.data) === 'verifying'
        ? VERIFYING_POLL_MS
        : false,
  });

  const onboard = useMutation<{ url: string }, ApiError>({
    mutationFn: startStripeOnboarding,
    // Links are single-use and expire in minutes, so go straight there.
    onSuccess: ({ url }) => window.location.assign(url),
  });

  // Success counts too: the button must stay disabled while the browser is
  // leaving for Stripe, or a second click spends a second link.
  const redirecting = onboard.isPending || onboard.isSuccess;

  // Pressing Back from Stripe can restore this page from the bfcache with the
  // mutation still marked successful, which would leave the button stuck.
  const { reset } = onboard;
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        reset();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [reset]);

  // The dashboard page owns the redirect to /login.
  if (error?.status === 401) {
    return null;
  }

  const phase = data ? payoutPhase(data) : undefined;

  const onboardButton = (label: string, variant: 'primary' | 'secondary' = 'primary') => (
    <div>
      <Button
        type="button"
        variant={variant}
        disabled={redirecting}
        onClick={() => onboard.mutate()}
      >
        {redirecting ? 'Redirecting to Stripe…' : label}
      </Button>
    </div>
  );

  const purchaseNote = shopApproved && !data?.chargesEnabled && (
    <p className="text-sm text-ink-muted">
      Your products are listed, but buyers can&apos;t purchase them until you
      can receive funds.
    </p>
  );

  let body: React.ReactNode;

  if (isPending) {
    body = (
      <p className="text-sm text-ink-muted">
        {arrival === 'return' ? 'Checking your Stripe status…' : 'Loading…'}
      </p>
    );
  } else if (error) {
    body = (
      <p className="text-sm text-danger">
        Couldn&apos;t load your payout status: {error.message}
      </p>
    );
  } else if (phase === 'not-connected') {
    body = (
      <>
        <p className="text-sm text-ink-muted">
          Connect a Stripe account to receive money from your sales. This is
          separate from shop approval — you can do it at any point.
        </p>
        {purchaseNote}
        {onboardButton('Connect payouts')}
      </>
    );
  } else {
    const linkExpired = arrival === 'refresh' && phase !== 'active';

    body = (
      <>
        {linkExpired && (
          <p className="text-sm text-ink">
            That Stripe link expired — they only last a few minutes. Continue
            to pick up where you left off with a fresh one.
          </p>
        )}

        {phase === 'incomplete' && !linkExpired && (
          <p className="text-sm text-ink-muted">
            {arrival === 'return'
              ? 'You left Stripe before finishing. Your progress is saved.'
              : 'Stripe still needs some details before you can be paid.'}
          </p>
        )}
        {phase === 'verifying' && (
          <p className="text-sm text-ink-muted">
            Stripe has your details and is verifying them. This usually takes a
            few minutes but can take longer. You can&apos;t receive funds from
            sales until it&apos;s done.
          </p>
        )}
        {phase === 'payouts-pending' && (
          <p className="text-sm text-ink-muted">
            You can receive funds from sales. Stripe is still enabling payouts
            to your bank, so funds are held in your Stripe balance until then.
          </p>
        )}
        {phase === 'active' && (
          <p className="text-sm text-ink-muted">
            You&apos;re all set to receive funds from sales and payouts to your
            bank.
          </p>
        )}

        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <Capability label="Receive funds from sales" enabled={data.chargesEnabled} />
          <Capability label="Payouts to your bank" enabled={data.payoutsEnabled} />
        </div>

        {purchaseNote}

        {(phase === 'incomplete' || linkExpired) &&
          onboardButton('Continue setup')}
        {(phase === 'verifying' || phase === 'payouts-pending') &&
          !linkExpired &&
          onboardButton('Update details', 'secondary')}
      </>
    );
  }

  return (
    <section className="w-full max-w-lg rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">Payouts</h2>
        {phase && <Badge phase={phase} />}
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {body}
        {onboard.error && (
          <p className="text-sm text-danger">{onboard.error.message}</p>
        )}
      </div>
    </section>
  );
}
