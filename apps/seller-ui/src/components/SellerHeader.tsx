'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/api';
import { unregisterPush } from '@/lib/push';
import { useNotifications } from '@/lib/realtime';
import { NotificationBell } from './NotificationBell';

/**
 * The top bar for a logged-in seller: navigation, the notification bell and Log out.
 *
 * Rendered from the root layout on every route and renders nothing while anonymous, so
 * the login and register pages stay bare without a per-route layout deciding.
 */
export function SellerHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const [leaving, setLeaving] = useState(false);

  if (!data) {
    return null;
  }

  async function signOut() {
    setLeaving(true);
    // In this order: the push token can only be removed while still authenticated.
    await unregisterPush();
    await logout();
    // Clearing the cache drops the notifications data, which disconnects the socket.
    queryClient.clear();
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2 text-sm">
        <a href="/dashboard" className="font-semibold text-ink">
          OpenShelf for Sellers
        </a>
        <nav className="flex gap-3 text-ink-muted">
          <a href="/products" className="hover:text-ink">
            Products
          </a>
          <a href="/orders" className="hover:text-ink">
            Orders
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-ink-muted">
          <NotificationBell />
          <button
            type="button"
            onClick={signOut}
            disabled={leaving}
            className="hover:text-ink disabled:opacity-50"
          >
            {leaving ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </div>
    </header>
  );
}
