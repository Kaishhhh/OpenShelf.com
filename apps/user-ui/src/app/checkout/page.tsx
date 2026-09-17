'use client';

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CartNotice, CheckoutResponse } from '@openshelf/types';
import { Button } from '@openshelf/ui';
import { ApiError, startCheckout } from '@/lib/api';
import { loginUrl } from '@/lib/return-to';
import { stripePromise } from '@/lib/stripe';
import { CART_KEY, useCart } from '@/lib/use-cart';
import { formatCents, formatMoney } from '@/components/Price';
import { EmptyState } from '@/components/ProductGrid';

/**
 * The payment form, inside Elements. confirmPayment redirects to the success page on
 * success; a decline resolves with an error instead and the buyer stays here to retry,
 * against the same PaymentIntent.
 */
function PaymentForm({ checkout }: { checkout: CheckoutResponse }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success`,
      },
    });

    // Only reached when confirmation failed before a redirect — a decline, a validation
    // error in the form. Success always leaves the page.
    setError(result.error.message ?? 'Payment failed. Please try again.');
    setSubmitting(false);
  }

  return (
    <form onSubmit={pay} className="flex flex-col gap-3">
      {/* Without this a form that fails to load (a bad key, a network block) renders as
          nothing at all beside a Pay button that can never work. */}
      <PaymentElement
        onLoadError={(event) =>
          setError(
            event.error.message ??
              'The payment form could not be loaded. Please refresh and try again.'
          )
        }
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={!stripe || !elements}>
          Pay {formatCents(checkout.amount)}
        </Button>
        <a href="/checkout/cancel" className="text-sm text-ink-muted hover:text-ink">
          Cancel
        </a>
      </div>
    </form>
  );
}

function noticeText(notice: CartNotice): string {
  if (notice.type === 'removed') {
    return `${notice.title} is no longer available.`;
  }
  return notice.quantity === 0
    ? `${notice.title} is out of stock.`
    : `Only ${notice.quantity} of ${notice.title} left.`;
}

export default function CheckoutPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: cart, isPending, anonymous, error } = useCart();

  const start = useMutation<CheckoutResponse, ApiError>({
    mutationFn: startCheckout,
    onError: (err) => {
      // The server refused because the cart changed; refresh it so the summary
      // shows what the buyer would actually be paying for.
      if (err.status === 400) {
        queryClient.invalidateQueries({ queryKey: CART_KEY });
      }
    },
  });

  useEffect(() => {
    if (anonymous) {
      router.replace(loginUrl('/checkout'));
    }
  }, [anonymous, router]);

  if (isPending || anonymous) {
    return null;
  }

  if (error || !cart) {
    return <EmptyState message="Your cart could not be loaded. This is usually temporary." />;
  }

  if (cart.shops.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <EmptyState message="Your cart is empty." />
        <a href="/products" className="text-sm text-accent">
          Browse products
        </a>
      </div>
    );
  }

  const refusedNotices =
    start.error?.status === 400 && Array.isArray(start.error.details)
      ? (start.error.details as CartNotice[])
      : [];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">Checkout</h1>

      {/* Grouped by shop because that is how the order is split: one order per shop. */}
      {cart.shops.map((group) => (
        <section
          key={group.shop.id}
          className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink">{group.shop.name}</span>
            <span className="text-sm text-ink-muted">
              Subtotal {formatMoney(group.subtotal)}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => (
              <li key={item.productId} className="flex justify-between text-sm">
                <span className="truncate text-ink">
                  {item.quantity} × {item.title}
                </span>
                <span className="shrink-0 text-ink-muted">
                  {formatMoney(item.lineTotal)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-sm text-ink-muted">Total</span>
        <span className="text-lg font-semibold text-ink">{formatMoney(cart.total)}</span>
      </div>

      {cart.notices.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-card border border-line bg-line/30 p-3 text-sm text-ink-muted">
          {cart.notices.map((notice, index) => (
            <li key={`${notice.title}-${index}`}>{noticeText(notice)}</li>
          ))}
        </ul>
      )}

      {start.data ? (
        stripePromise ? (
          <Elements stripe={stripePromise} options={{ clientSecret: start.data.clientSecret }}>
            <PaymentForm checkout={start.data} />
          </Elements>
        ) : (
          <p className="text-sm text-danger">
            Payments are not configured (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set).
          </p>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {/* An explicit step rather than creating the PaymentIntent on page load: a
              buyer who only glances at the summary should not leave an intent behind. */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              loading={start.isPending}
              onClick={() => start.mutate()}
            >
              Continue to payment
            </Button>
            <a href="/cart" className="text-sm text-ink-muted hover:text-ink">
              Back to cart
            </a>
          </div>
          {start.isError && (
            <div className="text-sm text-danger">
              <p>{start.error.message}</p>
              {refusedNotices.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {refusedNotices.map((notice, index) => (
                    <li key={`${notice.title}-${index}`}>{noticeText(notice)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
