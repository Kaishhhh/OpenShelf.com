import type { Redis } from 'ioredis';

/**
 * Which rooms have a connected socket, on any instance.
 *
 * Why this exists instead of `io.in(room).fetchSockets()`: the Redis adapter decides how
 * many other instances to ask by running `PUBSUB NUMSUB` on its request channel. Behind a
 * multi-node Redis proxy — Upstash, and Redis Cluster generally — introspection only sees
 * the subscriptions on the node that answers, so it reports 1 while two instances are
 * subscribed. The adapter then asks nobody, `fetchSockets()` answers from the local
 * instance only, and a recipient connected to another instance is sent a push as well as
 * the live notification. Emitting is unaffected: PUBLISH still reaches every subscriber.
 *
 * So presence is recorded explicitly. Each room has a sorted set of socket ids scored by
 * when the entry expires. Every instance refreshes its own sockets on a heartbeat and
 * removes them on disconnect; an instance that crashes stops refreshing, and its entries
 * lapse within PRESENCE_TTL_MS. Reads drop lapsed entries before counting.
 */

export const PRESENCE_TTL_MS = 60_000;
export const PRESENCE_HEARTBEAT_MS = 20_000;

type PresenceRedis = Pick<Redis, 'multi'>;

export function presenceKey(room: string): string {
  return `presence:${room}`;
}

export interface Presence {
  /** Records or refreshes a socket in a room. */
  touch(room: string, socketId: string): Promise<void>;
  leave(room: string, socketId: string): Promise<void>;
  /** Live sockets in the room across every instance. */
  count(room: string): Promise<number>;
}

export function createPresence(redis: PresenceRedis, now: () => number = Date.now): Presence {
  return {
    async touch(room, socketId) {
      const key = presenceKey(room);
      await redis
        .multi()
        .zadd(key, now() + PRESENCE_TTL_MS, socketId)
        // The whole set expires if every instance holding it disappears.
        .pexpire(key, PRESENCE_TTL_MS * 2)
        .exec();
    },

    async leave(room, socketId) {
      await redis.multi().zrem(presenceKey(room), socketId).exec();
    },

    async count(room) {
      const key = presenceKey(room);
      const results = await redis
        .multi()
        .zremrangebyscore(key, '-inf', now())
        .zcard(key)
        .exec();
      const [error, value] = results?.[1] ?? [new Error('presence read returned no result'), 0];
      if (error) {
        throw error;
      }
      return Number(value);
    },
  };
}
