/**
 * Notification shapes shared by notification-service's responses and both UIs.
 *
 * The same projection is returned by GET /notifications and emitted over the socket as
 * `notification:new`, so a live item and a fetched one are interchangeable in a cache.
 */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  orderId: string | null;
  /** ISO timestamp, or null while unread. */
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: NotificationItem[];
  /** Across all of the recipient's notifications, not just this page. */
  unreadCount: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Socket events. */
export const NOTIFICATION_EVENTS = {
  NEW: 'notification:new',
  READ: 'notification:read',
  SESSION_EXPIRED: 'session:expired',
} as const;

/** `notification:read` payload: specific ids, or everything. */
export type NotificationReadPayload = { ids: string[] } | { all: true };
