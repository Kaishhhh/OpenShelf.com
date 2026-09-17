'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import {
  ApiError,
  getShop,
  listShopOrders,
  type SellerOrderPage,
  type Shop,
} from '@/lib/api';
import { PayoutsPanel } from './PayoutsPanel';

function Panel({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6">
      <h1 className="text-base font-semibold text-ink">{title}</h1>
      {children && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function ShopPanel({ data, error }: { data?: Shop; error: ApiError | null }) {
  if (error) {
    if (error.status === 404) {
      return (
        <Panel title="You haven't set up your shop yet">
          <p className="text-sm text-ink-muted">
            Your shop needs to be created and approved before you can list
            products.
          </p>
          <p className="text-sm">
            <a href="/shop/new" className="text-accent">
              Set up your shop
            </a>
          </p>
        </Panel>
      );
    }

    return (
      <Panel title="Something went wrong">
        <p className="text-sm text-danger">{error.message}</p>
      </Panel>
    );
  }

  if (!data) {
    return null;
  }

  if (data.status === 'PENDING') {
    return (
      <Panel title="Your shop is under review">
        <p className="text-sm text-ink-muted">
          {data.name} was submitted and is waiting on an admin. You will be able
          to list products once it is approved.
        </p>
      </Panel>
    );
  }

  if (data.status === 'REJECTED') {
    return (
      <Panel title="Your shop was not approved">
        {data.rejectionReason ? (
          <p className="text-sm text-ink">{data.rejectionReason}</p>
        ) : (
          <p className="text-sm text-ink-muted">
            No reason was given. Contact support if you think this is a mistake.
          </p>
        )}
        <p className="text-sm">
          <a href="/shop/new" className="text-accent">
            Update and resubmit
          </a>
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={data.name}>
      <p className="text-sm text-ink-muted">
        Your shop is approved and visible to buyers.
      </p>
      <PendingOrders />
      <p className="flex gap-4 text-sm">
        <a href="/products" className="text-accent">
          Manage products
        </a>
        <a href="/orders" className="text-accent">
          View orders
        </a>
      </p>
    </Panel>
  );
}

/**
 * Orders paid for and not yet shipped. Only rendered for an approved shop — the endpoint
 * 403s any other — and reads `total` from a one-row page rather than a count endpoint of
 * its own.
 */
function PendingOrders() {
  const { data, isPending, error } = useQuery<SellerOrderPage, ApiError>({
    queryKey: ['shop-orders', 'PAID', 'count'],
    queryFn: () => listShopOrders({ status: 'PAID', limit: 1 }),
  });

  if (isPending || error) {
    return null;
  }

  return (
    <p className="text-sm text-ink">
      {data.total === 0 ? (
        <span className="text-ink-muted">No orders awaiting shipment.</span>
      ) : (
        <a href="/orders?status=PAID" className="text-accent">
          {data.total} {data.total === 1 ? 'order' : 'orders'} awaiting shipment
        </a>
      )}
    </p>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const { data, error, isPending } = useQuery<Shop, ApiError>({
    queryKey: ['shop'],
    queryFn: getShop,
    // A seller with no shop is the normal state right after registering, and
    // it arrives as a 404 — retrying it would just repeat a correct answer.
    retry: false,
  });

  const unauthenticated = error?.status === 401;

  useEffect(() => {
    if (unauthenticated) {
      router.replace('/login');
    }
  }, [unauthenticated, router]);

  if (isPending || unauthenticated) {
    return null;
  }

  // Payouts render in every shop state, including no shop at all. Getting paid
  // and being approved are separate: a seller can connect Stripe while their
  // shop is pending, and an approved shop can have no Stripe account.
  return (
    <div className="flex w-full max-w-lg flex-col gap-4 py-8">
      <ShopPanel data={data} error={error} />
      {/* PayoutsPanel reads the query string, which Next requires to sit under Suspense. */}
      <Suspense fallback={null}>
        <PayoutsPanel shopApproved={data?.status === 'APPROVED'} />
      </Suspense>
    </div>
  );
}
