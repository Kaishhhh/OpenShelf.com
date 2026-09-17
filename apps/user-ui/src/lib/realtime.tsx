'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  NOTIFICATION_EVENTS,
  type NotificationItem,
  type NotificationPage,
} from '@openshelf/types';
import { ApiError, listNotifications } from './api';
import { resyncPushIfGranted } from './push';
import { refreshSession } from './session';

/**
 * The socket goes through the gateway, like every other browser request, so the
 * access_token cookie for the gateway's origin is sent with the handshake.
 */
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:8080';
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/notification/socket.io';

export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const NOTIFICATIONS_LIMIT = 10;

/**
 * The recent notifications and unread count. Doubles as "am I logged in": a 401 means
 * anonymous, which is what starts or stops the socket.
 */
export function useNotifications() {
  const query = useQuery<NotificationPage, ApiError>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => listNotifications(NOTIFICATIONS_LIMIT),
    retry: false,
    staleTime: 60_000,
  });
  return { ...query, anonymous: query.error?.status === 401 };
}

type Status = 'disconnected' | 'connecting' | 'connected';
const RealtimeStatus = createContext<Status>('disconnected');

export function useRealtimeStatus(): Status {
  return useContext(RealtimeStatus);
}

function prepend(page: NotificationPage | undefined, item: NotificationItem) {
  if (!page || page.notifications.some((n) => n.id === item.id)) {
    return page;
  }
  return {
    ...page,
    notifications: [item, ...page.notifications].slice(0, page.limit),
    total: page.total + 1,
    unreadCount: page.unreadCount + (item.readAt ? 0 : 1),
  };
}

/**
 * Holds the socket for the logged-in buyer.
 *
 * Connects once the notifications query has succeeded and disconnects when it no longer
 * has data — logout clears the query cache, which is what ends the connection.
 *
 * Websocket-only: long-polling would need sticky sessions to work across more than one
 * notification-service instance.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const loggedIn = data !== undefined;
  const [status, setStatus] = useState<Status>('disconnected');

  useEffect(() => {
    if (!loggedIn) {
      return;
    }

    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      withCredentials: true,
    });
    setStatus('connecting');

    // One refresh per authentication failure. If the refreshed session is rejected too,
    // stop — the user is logged out, and the notifications query will say so.
    let refreshing = false;
    const reauthenticate = async () => {
      if (refreshing) return;
      refreshing = true;
      const ok = await refreshSession();
      refreshing = false;
      if (ok) {
        socket.connect();
      } else {
        socket.disconnect();
        await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      }
    };

    socket.on('connect', () => {
      setStatus('connected');
      // Anything written while this tab was not connected arrives on its next fetch.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    });

    socket.on('disconnect', (reason) => {
      setStatus('disconnected');
      // The server ends a socket when its token expires. Socket.IO does not reconnect
      // after a server-initiated disconnect, so this does, with a refreshed session.
      if (reason === 'io server disconnect') {
        void reauthenticate();
      }
    });

    socket.on('connect_error', (err) => {
      setStatus('disconnected');
      if (err.message === 'Not authenticated') {
        void reauthenticate();
      }
    });

    socket.on(NOTIFICATION_EVENTS.NEW, (item: NotificationItem) => {
      queryClient.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (page) => prepend(page, item));
    });

    // Another tab (or this one) marked something read. The server is the source of truth
    // for the count, including notifications older than the ones in this cache.
    socket.on(NOTIFICATION_EVENTS.READ, () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    });

    void resyncPushIfGranted();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setStatus('disconnected');
    };
  }, [loggedIn, queryClient]);

  return <RealtimeStatus.Provider value={status}>{children}</RealtimeStatus.Provider>;
}
