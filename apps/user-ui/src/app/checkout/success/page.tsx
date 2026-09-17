'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { OrderCard } from '@/components/OrderCard';
import { formatCents } from '@/components/Price';
import { loginUrl } from '@/lib/return-to';
import { CART_KEY } from '@/lib/use-cart';
import { useOrdersForPayment } from '@/lib/use-orders';

function Success() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  // Stripe appends these to return_url. redirect_status is a hint for what to say while
  // waiting, never a basis for saying the order exists — only the server's orders are.
  const paymentIntentId = searchParams.get('payment_intent');
  const redirectStatus = searchParams.get('redirect_status');

  const { data, landed, timedOut, anonymous, error } =
    useOrdersForPayment(paymentIntentId);

  useEffect(() => {
    if (anonymous) {
      router.replace(loginUrl(`/checkout/success?${searchParams.toString()}`));
    }
  }, [anonymous, router, searchParams]);

  // The webhook removed the paid lines server-side; refresh the header badge to match.
  useEffect(() => {
    if (landed) {
      queryClient.invalidateQueries({ queryKey: CART_KEY });
    }
  }, [landed, queryClient]);

  if (!paymentIntentId) {
    return <Message title="Nothing to confirm" body="No payment was found in this link." />;
  }

  if (redirectStatus === 'failed') {
    return (
      <Message
        title="Payment was not completed"
        body="Your card was not charged and your cart is unchanged."
        link={{ href: '/checkout', label: 'Try again' }}
      />
    );
  }

  if (error && !anonymous) {
    return <Message title="Could not check your order" body={error.message} />;
  }

  if (landed && data) {
    const total = data.orders.reduce((sum, order) => sum + order.subtotal, 0);
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-ink">Thank you — your order is confirmed</h1>
          <p className="text-sm text-ink-muted">
            {data.orders.length === 1
              ? 'One order'
              : `${data.orders.length} orders, one per shop`}
            , {formatCents(total)} in total.
          </p>
        </div>
        {data.orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
        <a href="/orders" className="text-sm text-accent">
          View all orders
        </a>
      </div>
    );
  }

  if (timedOut) {
    return (
      <Message
        title="Still confirming your payment"
        body="This is taking longer than usual. Your orders will appear in your order history once the payment is confirmed — there is no need to pay again."
        link={{ href: '/orders', label: 'Go to your orders' }}
      />
    );
  }

  return (
    <Message
      title="Confirming your payment…"
      body="This usually takes a few seconds. Please keep this page open."
    />
  );
}

function Message({
  title,
  body,
  link,
}: {
  title: string;
  body: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted">{body}</p>
      {link && (
        <a href={link.href} className="text-sm text-accent">
          {link.label}
        </a>
      )}
    </div>
  );
}

export default function CheckoutSuccessPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <Success />
    </Suspense>
  );
}
