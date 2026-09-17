import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthError, NotFoundError, ValidationError } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import { NOTIFICATION_READ_EVENT } from '../delivery/deliver.js';
import { registerToken, removeTokens } from '../delivery/fcm-tokens.js';
import { getRealtime, type RecipientRole } from '../realtime/socket.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// FCM web tokens are long opaque strings; the bounds only keep out garbage and abuse.
const tokenBodySchema = z.object({ token: z.string().trim().min(20).max(4096) }).strict();

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * "Unread" on MongoDB. Prisma's `readAt: null` matches only a stored null — not a document
 * with no readAt field, which is how rows written before readAt was set explicitly look.
 * Both mean unread, so both are matched.
 */
const UNREAD = { OR: [{ readAt: null }, { readAt: { isSet: false } }] };
const NOT_FOUND_MESSAGE = 'Notification not found';

/**
 * What a recipient sees. eventId is internal plumbing (the idempotency key), and the
 * recipient fields are the caller themselves, so neither is returned.
 */
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  orderId: true,
  readAt: true,
  createdAt: true,
} as const;

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.issues);
  }
  return result.data;
}

interface Recipient {
  recipientRole: RecipientRole;
  recipientId: string;
}

/**
 * The recipient is always the authenticated caller — never anything in the request — so a
 * caller can only ever read or change their own notifications and tokens.
 */
function recipientOf(req: Request, role: RecipientRole): Recipient {
  const id = role === 'SELLER' ? req.seller?.id : req.user?.id;
  if (!id) {
    throw new AuthError('Not authenticated');
  }
  return { recipientRole: role, recipientId: id };
}

/** Tells the caller's other tabs, so a badge cleared in one clears in all. */
function broadcastRead(recipient: Recipient, payload: { ids: string[] } | { all: true }) {
  getRealtime()?.emitToRecipient(
    recipient.recipientRole,
    recipient.recipientId,
    NOTIFICATION_READ_EVENT,
    payload
  );
}

async function list(role: RecipientRole, req: Request, res: Response) {
  const recipient = recipientOf(req, role);
  const { page, limit } = parse(listQuerySchema, req.query);

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: recipient,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: NOTIFICATION_SELECT,
    }),
    prisma.notification.count({ where: recipient }),
    prisma.notification.count({ where: { ...recipient, ...UNREAD } }),
  ]);

  return res.status(200).json({
    notifications,
    unreadCount,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
}

/**
 * Marks one notification read. Idempotent: an already-read notification stays read with
 * its original readAt. Another recipient's notification is a 404, indistinguishable from
 * one that does not exist.
 */
async function markRead(role: RecipientRole, req: Request, res: Response) {
  const recipient = recipientOf(req, role);
  const id = String(req.params.id ?? '');
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }

  const { count } = await prisma.notification.updateMany({
    where: { id, ...recipient, ...UNREAD },
    data: { readAt: new Date() },
  });

  const notification = await prisma.notification.findFirst({
    where: { id, ...recipient },
    select: NOTIFICATION_SELECT,
  });
  if (!notification) {
    throw new NotFoundError(NOT_FOUND_MESSAGE);
  }

  if (count > 0) {
    broadcastRead(recipient, { ids: [id] });
  }
  return res.status(200).json(notification);
}

async function markAllRead(role: RecipientRole, req: Request, res: Response) {
  const recipient = recipientOf(req, role);
  const { count } = await prisma.notification.updateMany({
    where: { ...recipient, ...UNREAD },
    data: { readAt: new Date() },
  });
  if (count > 0) {
    broadcastRead(recipient, { all: true });
  }
  return res.status(200).json({ updated: count });
}

async function addToken(role: RecipientRole, req: Request, res: Response) {
  const recipient = recipientOf(req, role);
  const { token } = parse(tokenBodySchema, req.body);
  await registerToken(recipient.recipientRole, recipient.recipientId, token);
  return res.status(204).end();
}

async function deleteToken(role: RecipientRole, req: Request, res: Response) {
  const recipient = recipientOf(req, role);
  const { token } = parse(tokenBodySchema, req.body);
  await removeTokens(recipient.recipientRole, recipient.recipientId, [token]);
  return res.status(204).end();
}

export const listUserNotifications = (req: Request, res: Response) => list('USER', req, res);
export const listSellerNotifications = (req: Request, res: Response) => list('SELLER', req, res);
export const markUserNotificationRead = (req: Request, res: Response) => markRead('USER', req, res);
export const markSellerNotificationRead = (req: Request, res: Response) =>
  markRead('SELLER', req, res);
export const markAllUserNotificationsRead = (req: Request, res: Response) =>
  markAllRead('USER', req, res);
export const markAllSellerNotificationsRead = (req: Request, res: Response) =>
  markAllRead('SELLER', req, res);
export const registerUserToken = (req: Request, res: Response) => addToken('USER', req, res);
export const registerSellerToken = (req: Request, res: Response) => addToken('SELLER', req, res);
export const removeUserToken = (req: Request, res: Response) => deleteToken('USER', req, res);
export const removeSellerToken = (req: Request, res: Response) => deleteToken('SELLER', req, res);
