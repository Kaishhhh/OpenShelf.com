'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderPage } from '@openshelf/types';
import { ApiError, listOrders } from './api';

export const ORDERS_KEY = ['orders'] as const;

/** A page of the buyer's order history. `anonymous` mirrors useCart. */
export function useOrders(page: number) {
  const query = useQuery<OrderPage, ApiError>({
    queryKey: [...ORDERS_KEY, page],
    queryFn: () => listOrders({ page }),
    retry: false,
  });
  return { ...query, anonymous: query.error?.status === 401 };
}

const POLL_INTERVAL_MS = 2_000;
/** About a minute. Webhooks normally land in seconds; past this, say so and stop. */
const MAX_POLLS = 30;

/**
 * Waits for the webhook to have written the orders for one checkout.
 *
 * Stripe redirecting the buyer back proves nothing — the client can reach the success URL
 * with a failed or still-processing payment, or by typing it. Only orders existing on the
 * server mean the payment was confirmed, so this polls for them rather than trusting the
 * redirect.
 */
export function useOrdersForPayment(paymentIntentId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = [...ORDERS_KEY, 'payment', paymentIntentId];

  const query = useQuery<OrderPage, ApiError>({
    queryKey,
    queryFn: () =>
      listOrders({ paymentIntentId: paymentIntentId as string, limit: 50 }),
    enabled: paymentIntentId !== null,
    retry: false,
    refetchInterval: (q) => {
      const landed = (q.state.data?.orders.length ?? 0) > 0;
      const gaveUp = q.state.dataUpdateCount >= MAX_POLLS;
      return landed || gaveUp || q.state.error ? false : POLL_INTERVAL_MS;
    },
  });

  const landed = (query.data?.orders.length ?? 0) > 0;
  // The poll count lives on the query's cache state, not the hook result. Every poll
  // re-renders, so reading it here is always current.
  const polls = queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;
  const timedOut = !landed && polls >= MAX_POLLS;

  return { ...query, landed, timedOut, anonymous: query.error?.status === 401 };
}
