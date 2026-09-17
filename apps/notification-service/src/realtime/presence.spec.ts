import { createPresence, PRESENCE_TTL_MS, presenceKey, type Presence } from './presence.js';

/** A sorted-set Redis fake with MULTI semantics, shared by several "instances". */
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const set = (key: string) => {
    if (!sets.has(key)) sets.set(key, new Map());
    return sets.get(key) as Map<string, number>;
  };

  const multi = () => {
    const ops: (() => [Error | null, unknown])[] = [];
    const chain = {
      zadd(key: string, score: number, member: string) {
        ops.push(() => {
          set(key).set(member, score);
          return [null, 1];
        });
        return chain;
      },
      pexpire() {
        ops.push(() => [null, 1]);
        return chain;
      },
      zrem(key: string, member: string) {
        ops.push(() => [null, set(key).delete(member) ? 1 : 0]);
        return chain;
      },
      zremrangebyscore(key: string, _min: string, max: number) {
        ops.push(() => {
          let removed = 0;
          for (const [member, score] of set(key)) {
            if (score <= max) {
              set(key).delete(member);
              removed++;
            }
          }
          return [null, removed];
        });
        return chain;
      },
      zcard(key: string) {
        ops.push(() => [null, set(key).size]);
        return chain;
      },
      exec: async () => ops.map((op) => op()),
    };
    return chain;
  };

  return { redis: { multi } as never, sets };
}

const ROOM = 'seller:6aa815f1029187b933a0708d';

describe('presence', () => {
  let clock: number;
  let shared: ReturnType<typeof fakeRedis>;
  let instanceA: Presence;
  let instanceB: Presence;

  beforeEach(() => {
    clock = 1_000_000;
    shared = fakeRedis();
    instanceA = createPresence(shared.redis, () => clock);
    instanceB = createPresence(shared.redis, () => clock);
  });

  // The failure this module exists for: the socket is on B, the question is asked on A.
  it('counts a socket connected to another instance', async () => {
    await instanceB.touch(ROOM, 'socket-on-b');
    await expect(instanceA.count(ROOM)).resolves.toBe(1);
  });

  it('is zero once the socket leaves', async () => {
    await instanceB.touch(ROOM, 'socket-on-b');
    await instanceB.leave(ROOM, 'socket-on-b');
    await expect(instanceA.count(ROOM)).resolves.toBe(0);
  });

  it('counts each socket once, however often it is refreshed', async () => {
    await instanceA.touch(ROOM, 's1');
    await instanceA.touch(ROOM, 's1');
    await instanceB.touch(ROOM, 's2');
    await expect(instanceA.count(ROOM)).resolves.toBe(2);
  });

  // An instance that crashed never sends leave; its entries must not keep a recipient
  // "online" forever (which would suppress their pushes).
  it('forgets sockets whose instance stopped refreshing them', async () => {
    await instanceB.touch(ROOM, 'socket-on-crashed-b');
    clock += PRESENCE_TTL_MS + 1;
    await expect(instanceA.count(ROOM)).resolves.toBe(0);
    expect(shared.sets.get(presenceKey(ROOM))?.size).toBe(0);
  });

  it('keeps a socket that is still being refreshed past the first TTL', async () => {
    await instanceB.touch(ROOM, 's1');
    clock += PRESENCE_TTL_MS - 1_000;
    await instanceB.touch(ROOM, 's1');
    clock += PRESENCE_TTL_MS - 1_000;
    await expect(instanceA.count(ROOM)).resolves.toBe(1);
  });

  it('keeps rooms separate', async () => {
    await instanceA.touch(ROOM, 's1');
    await expect(instanceA.count('user:6a799c56c5d2c32dd3ffcf6c')).resolves.toBe(0);
  });
});
