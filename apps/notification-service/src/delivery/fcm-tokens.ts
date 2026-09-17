import { prisma } from '@openshelf/prisma';
import type { RecipientRole } from '../realtime/socket.js';

/** A browser that enabled push more times than this drops its oldest registrations. */
export const MAX_FCM_TOKENS = 10;

export async function loadTokens(role: RecipientRole, id: string): Promise<string[]> {
  const row =
    role === 'SELLER'
      ? await prisma.seller.findUnique({ where: { id }, select: { fcmTokens: true } })
      : await prisma.user.findUnique({ where: { id }, select: { fcmTokens: true } });
  return row?.fcmTokens ?? [];
}

async function setTokens(role: RecipientRole, id: string, tokens: string[]): Promise<void> {
  if (role === 'SELLER') {
    await prisma.seller.update({ where: { id }, data: { fcmTokens: { set: tokens } } });
  } else {
    await prisma.user.update({ where: { id }, data: { fcmTokens: { set: tokens } } });
  }
}

/**
 * Registers a device's token against one account.
 *
 * A token identifies a browser, not a person. If someone logs out of one account and into
 * another in the same browser, the token must move — otherwise the first account's
 * notifications keep arriving on a device that now belongs to the second. So the token is
 * first removed from every other buyer and seller that holds it.
 *
 * Read-modify-write rather than an atomic push: Prisma's MongoDB connector has no pull on
 * scalar lists. The race is two registrations for the same account at the same moment,
 * which at worst drops one of two duplicate tokens.
 */
export async function registerToken(role: RecipientRole, id: string, token: string): Promise<void> {
  const [users, sellers] = await Promise.all([
    prisma.user.findMany({ where: { fcmTokens: { has: token } }, select: { id: true, fcmTokens: true } }),
    prisma.seller.findMany({ where: { fcmTokens: { has: token } }, select: { id: true, fcmTokens: true } }),
  ]);

  for (const other of users) {
    if (role === 'USER' && other.id === id) continue;
    await setTokens('USER', other.id, other.fcmTokens.filter((t) => t !== token));
  }
  for (const other of sellers) {
    if (role === 'SELLER' && other.id === id) continue;
    await setTokens('SELLER', other.id, other.fcmTokens.filter((t) => t !== token));
  }

  const current = await loadTokens(role, id);
  const next = [...current.filter((t) => t !== token), token].slice(-MAX_FCM_TOKENS);
  await setTokens(role, id, next);
}

/** Removes tokens from one account. Unknown tokens are ignored. */
export async function removeTokens(role: RecipientRole, id: string, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const current = await loadTokens(role, id);
  const next = current.filter((t) => !tokens.includes(t));
  if (next.length !== current.length) {
    await setTokens(role, id, next);
  }
}
