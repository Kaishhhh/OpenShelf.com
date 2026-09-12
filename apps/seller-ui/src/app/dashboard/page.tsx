'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ApiError, getShop, type Shop } from '@/lib/api';

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
      <p className="text-sm">
        <a href="/products" className="text-accent">
          Manage products
        </a>
      </p>
    </Panel>
  );
}
