import type { PushMessage, PushResult } from '@openshelf/firebase';
import type { Realtime, RecipientRole } from '../realtime/socket.js';

const LOG = '[delivery]';

export const NOTIFICATION_NEW_EVENT = 'notification:new';
export const NOTIFICATION_READ_EVENT = 'notification:read';

/** What a recipient sees — the same projection GET /notifications returns. */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  orderId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface DeliverableNotification extends NotificationView {
  recipientRole: RecipientRole;
  recipientId: string;
}

export interface DeliveryDeps {
  realtime: () => Realtime | undefined;
  sendPush: (tokens: string[], message: PushMessage) => Promise<PushResult>;
  loadTokens: (role: RecipientRole, id: string) => Promise<string[]>;
  removeTokens: (role: RecipientRole, id: string, tokens: string[]) => Promise<void>;
  /** Base URL of the UI a recipient uses, for the push click-through. */
  uiUrl: (role: RecipientRole) => string;
}

export function toView(row: DeliverableNotification): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    orderId: row.orderId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export type DeliveryOutcome = 'emitted' | 'pushed' | 'no-channel' | 'failed';

/**
 * Delivers a notification that is **already written**. Write first, then deliver: a
 * notification someone saw but that was never persisted is worse than a persisted one that
 * shows up on their next load.
 *
 * 1. Emit to the recipient's room. Harmless if nobody is there.
 * 2. Ask the adapter whether the room has sockets on any instance.
 * 3. Only if it has none, send a push. A connected recipient already has it on screen, and
 *    a duplicate is worse than nothing.
 *
 * Never throws: the Kafka handler has done its job once the row exists, and a failure here
 * must not send the event to the retry topic (which would rewrite nothing and re-deliver
 * nothing — the row is a duplicate by then). Failures are logged loudly, the same posture
 * as sendOtpEmail.
 */
export function createDeliverer(deps: DeliveryDeps) {
  return async function deliver(row: DeliverableNotification): Promise<DeliveryOutcome> {
    const who = `${row.recipientRole}:${row.recipientId}`;
    const realtime = deps.realtime();

    if (realtime) {
      try {
        realtime.emitToRecipient(row.recipientRole, row.recipientId, NOTIFICATION_NEW_EVENT, toView(row));
      } catch (err) {
        console.error(`${LOG} emit to ${who} failed for notification ${row.id} —`, err);
      }

      try {
        if (await realtime.hasConnectedSockets(row.recipientRole, row.recipientId)) {
          console.log(`${LOG} ${row.id} emitted to ${who}; connected, push skipped`);
          return 'emitted';
        }
      } catch (err) {
        // Presence unknown. Pushing risks a duplicate; not pushing risks a miss. A miss is
        // recoverable — the row is in their feed on next load — so err towards silence.
        console.error(`${LOG} presence check for ${who} failed; push skipped for ${row.id} —`, err);
        return 'failed';
      }
    }

    try {
      const tokens = await deps.loadTokens(row.recipientRole, row.recipientId);
      if (tokens.length === 0) {
        console.log(`${LOG} ${row.id} for ${who}: not connected and no push tokens`);
        return 'no-channel';
      }

      const result = await deps.sendPush(tokens, {
        title: row.title,
        body: row.body,
        link: row.orderId ? `${deps.uiUrl(row.recipientRole)}/orders/${row.orderId}` : deps.uiUrl(row.recipientRole),
        data: { notificationId: row.id, ...(row.orderId ? { orderId: row.orderId } : {}) },
      });

      if (result.invalidTokens.length > 0) {
        await deps.removeTokens(row.recipientRole, row.recipientId, result.invalidTokens);
        console.warn(`${LOG} removed ${result.invalidTokens.length} dead push token(s) from ${who}`);
      }

      if (result.successCount === 0) {
        console.error(
          `${LOG} push for ${row.id} to ${who} reached no device (${result.failureCount} failed)`
        );
        return 'failed';
      }
      console.log(`${LOG} ${row.id} for ${who}: not connected, pushed to ${result.successCount} device(s)`);
      return 'pushed';
    } catch (err) {
      console.error(`${LOG} push for ${row.id} to ${who} FAILED —`, err);
      return 'failed';
    }
  };
}
