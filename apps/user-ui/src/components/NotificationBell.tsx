'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { NotificationItem, NotificationPage } from '@openshelf/types';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/api';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { NOTIFICATIONS_KEY, useNotifications, useRealtimeStatus } from '@/lib/realtime';

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function markReadInCache(page: NotificationPage | undefined, ids: string[] | 'all') {
  if (!page) return page;
  const now = new Date().toISOString();
  let cleared = 0;
  const notifications = page.notifications.map((n) => {
    if (n.readAt || (ids !== 'all' && !ids.includes(n.id))) return n;
    cleared++;
    return { ...n, readAt: now };
  });
  return {
    ...page,
    notifications,
    unreadCount: ids === 'all' ? 0 : Math.max(0, page.unreadCount - cleared),
  };
}

/** Where a notification leads. `orderLink` is the app's own order page. */
const orderLink = (orderId: string) => `/orders/${orderId}`;

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const status = useRealtimeStatus();
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<PushState>('unsupported');
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const markOne = useMutation({
    mutationFn: markNotificationRead,
    // Optimistic, then reconciled with the server's count.
    onMutate: (id: string) =>
      queryClient.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (p) => markReadInCache(p, [id])),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: () =>
      queryClient.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (p) => markReadInCache(p, 'all')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: setPush,
  });

  if (!data) {
    return null;
  }

  const unread = data.unreadCount;

  function openItem(item: NotificationItem) {
    if (!item.readAt) markOne.mutate(item.id);
    setOpen(false);
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center hover:text-ink"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        data-socket={status}
        data-unread={unread}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-surface">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-card border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium text-ink">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {data.notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">No notifications yet.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {data.notifications.map((item) => (
                <li key={item.id} className="border-b border-line last:border-0">
                  <a
                    href={item.orderId ? orderLink(item.orderId) : '#'}
                    onClick={() => openItem(item)}
                    className="flex gap-2 px-3 py-2 hover:bg-line/30"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-accent'}`}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className={`text-sm ${item.readAt ? 'text-ink-muted' : 'font-medium text-ink'}`}>
                        {item.title}
                      </span>
                      <span className="text-xs text-ink-muted">{item.body}</span>
                      <span className="text-[11px] text-ink-muted">{timeAgo(item.createdAt)}</span>
                    </span>
                    {!item.readAt && <span className="sr-only">Unread</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {(push === 'default' || push === 'granted' || push === 'denied') && (
            <div className="border-t border-line px-3 py-2 text-xs text-ink-muted">
              {push === 'granted' ? (
                'Push notifications are on for this browser.'
              ) : push === 'denied' ? (
                'Push notifications are blocked in your browser settings.'
              ) : (
                <button
                  type="button"
                  disabled={enable.isPending}
                  onClick={() => enable.mutate()}
                  className="text-accent hover:underline disabled:opacity-50"
                >
                  {enable.isPending ? 'Enabling…' : 'Enable push notifications'}
                </button>
              )}
              {enable.isError && (
                <span className="block text-danger">Could not enable push notifications.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
