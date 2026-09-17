'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/api';
import { unregisterPush } from '@/lib/push';
import { useNotifications } from '@/lib/realtime';
import { NotificationBell } from './NotificationBell';

/**
 * The account end of the header: the bell and Log out when logged in, Log in and Register
 * otherwise. Nothing renders until the notifications query answers, so a logged-in buyer
 * never sees "Log in" flash first.
 */
export function HeaderAccount() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isPending } = useNotifications();
  const [leaving, setLeaving] = useState(false);

  if (isPending) {
    return null;
  }

  if (!data) {
    return (
      <>
        <a href="/login" className="hover:text-ink">
          Log in
        </a>
        <a href="/register" className="hover:text-ink">
          Register
        </a>
      </>
    );
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
    <>
      <NotificationBell />
      <button
        type="button"
        onClick={signOut}
        disabled={leaving}
        className="hover:text-ink disabled:opacity-50"
      >
        {leaving ? 'Logging out…' : 'Log out'}
      </button>
    </>
  );
}
