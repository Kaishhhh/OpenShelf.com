import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { parse as parseCookie } from 'cookie';
import { AuthError } from '@openshelf/errors';
import { verifyAccessToken } from '@openshelf/auth';
import { prisma } from '@openshelf/prisma';
import { redis } from '@openshelf/redis';
import { createPresence, PRESENCE_HEARTBEAT_MS } from './presence.js';

const LOG = '[realtime]';

export const SOCKET_PATH = '/api/socket.io';
export const NOT_AUTHENTICATED = 'Not authenticated';

export type RecipientRole = 'USER' | 'SELLER';

export interface SocketIdentity {
  role: RecipientRole;
  id: string;
  /** Token expiry, seconds since epoch. */
  exp: number;
}

/** The one room a connection joins. Buyer and seller ids live in different collections. */
export function roomFor(role: RecipientRole, id: string): string {
  return role === 'SELLER' ? `seller:${id}` : `user:${id}`;
}

/**
 * Authenticates a handshake from its Cookie header — the same `access_token` cookie the
 * HTTP routes read, verified by @openshelf/auth.
 *
 * Mirrors the HTTP guards: a SELLER token must name an existing Seller, a USER token an
 * existing User. Any other role (an admin token), a missing, forged or expired token, or
 * an account that no longer exists is rejected with the same message.
 */
export async function authenticateHandshake(
  cookieHeader: string | undefined
): Promise<SocketIdentity> {
  const token = cookieHeader ? parseCookie(cookieHeader).access_token : undefined;
  if (!token) {
    throw new AuthError(NOT_AUTHENTICATED);
  }

  const { sub, role, exp } = verifyAccessToken(token);

  if (role === 'SELLER') {
    const seller = await prisma.seller.findUnique({ where: { id: sub }, select: { id: true } });
    if (seller) return { role: 'SELLER', id: seller.id, exp };
  } else if (role === 'USER') {
    const user = await prisma.user.findUnique({ where: { id: sub }, select: { id: true } });
    if (user) return { role: 'USER', id: user.id, exp };
  }

  throw new AuthError(NOT_AUTHENTICATED);
}

export interface Realtime {
  io: Server;
  emitToRecipient(role: RecipientRole, id: string, event: string, payload: unknown): void;
  /** Whether any instance has a socket in the recipient's room. */
  hasConnectedSockets(role: RecipientRole, id: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface RealtimeOptions {
  corsOrigins: string[];
}

/**
 * Socket.IO on the service's existing HTTP server, with the Redis adapter.
 *
 * The adapter is what makes more than one instance work. Without it, an emit reaches only
 * the sockets connected to the instance that emitted — correct on one instance, silently
 * lost on two.
 *
 * Presence — whether to push — deliberately does not use the adapter's `fetchSockets`:
 * on Upstash it silently counts only local sockets. See presence.ts.
 *
 * Pub/sub needs a connection of its own: a Redis client in subscriber mode can run no
 * other commands. So the publisher is the shared @openshelf/redis client and the
 * subscriber a duplicate of it.
 */
export function createRealtime(server: HttpServer, options: RealtimeOptions): Realtime {
  const subscriber = redis.duplicate();
  const presence = createPresence(redis);
  subscriber.on('error', (err) => console.error(`${LOG} redis subscriber error —`, err));

  const io = new Server(server, {
    path: SOCKET_PATH,
    cors: { origin: options.corsOrigins, credentials: true },
    adapter: createAdapter(redis, subscriber),
  });

  // Rejecting in middleware means the client receives connect_error and the connection is
  // never established — an unauthenticated socket is refused, not accepted with no rooms.
  io.use((socket, next) => {
    authenticateHandshake(socket.handshake.headers.cookie)
      .then((identity) => {
        socket.data.identity = identity;
        next();
      })
      .catch((err) => {
        if (!(err instanceof AuthError)) {
          console.error(`${LOG} handshake failed unexpectedly —`, err);
        }
        next(new Error(NOT_AUTHENTICATED));
      });
  });

  io.on('connection', (socket) => {
    const identity = socket.data.identity as SocketIdentity;
    const room = roomFor(identity.role, identity.id);
    void socket.join(room);

    // A socket must not outlive the token it authenticated with. At expiry the server ends
    // it; the client refreshes the session and reconnects with the new cookie.
    const msUntilExpiry = identity.exp * 1000 - Date.now();
    const expiry = setTimeout(() => {
      socket.emit('session:expired');
      socket.disconnect(true);
    }, Math.max(0, msUntilExpiry));

    // Presence is best effort: a failed write means a possible duplicate push, never a
    // lost connection, so it is logged rather than allowed to end the socket.
    const touch = () =>
      presence.touch(room, socket.id).catch((err) =>
        console.error(`${LOG} presence refresh failed for ${room} socket=${socket.id} —`, err)
      );
    void touch();
    const heartbeat = setInterval(touch, PRESENCE_HEARTBEAT_MS);

    console.log(`${LOG} connected ${room} socket=${socket.id} expires in ${Math.round(msUntilExpiry / 1000)}s`);

    socket.on('disconnect', (reason) => {
      clearTimeout(expiry);
      clearInterval(heartbeat);
      presence.leave(room, socket.id).catch((err) =>
        console.error(`${LOG} presence removal failed for ${room} socket=${socket.id} —`, err)
      );
      console.log(`${LOG} disconnected ${room} socket=${socket.id} (${reason})`);
    });
  });

  return {
    io,
    emitToRecipient(role, id, event, payload) {
      io.to(roomFor(role, id)).emit(event, payload);
    },
    async hasConnectedSockets(role, id) {
      return (await presence.count(roomFor(role, id))) > 0;
    },
    async close() {
      await io.close();
      subscriber.disconnect();
    },
  };
}

let current: Realtime | undefined;

/** Set once by main.ts. HTTP handlers and delivery read it; tests leave it unset. */
export function setRealtime(realtime: Realtime | undefined): void {
  current = realtime;
}

export function getRealtime(): Realtime | undefined {
  return current;
}
