import { createSessionRefresher, REFRESHED_AT_KEY } from './session';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** A lock like navigator.locks: callbacks for the same name run one at a time. */
function serialLocks() {
  let tail = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const run = tail.then(callback);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
}

describe('refreshSession', () => {
  it('refreshes once for many concurrent 401s in one tab', async () => {
    let calls = 0;
    const refreshSession = createSessionRefresher({
      refresh: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return true;
      },
      storage: memoryStorage(),
    });

    const results = await Promise.all([refreshSession(1), refreshSession(2), refreshSession(3)]);
    expect(results).toEqual([true, true, true]);
    expect(calls).toBe(1);
  });

  // Two tabs sharing cookies and storage; rotating twice would trip reuse detection.
  it('refreshes once across two tabs that 401 at the same time', async () => {
    let calls = 0;
    let clock = 1_000;
    const storage = memoryStorage();
    const locks = serialLocks();
    const refresh = async () => {
      calls++;
      clock += 50;
      return true;
    };
    const tabA = createSessionRefresher({ refresh, storage, locks, now: () => clock });
    const tabB = createSessionRefresher({ refresh, storage, locks, now: () => clock });

    const started = clock;
    const [a, b] = await Promise.all([tabA(started), tabB(started)]);

    expect([a, b]).toEqual([true, true]);
    expect(calls).toBe(1);
  });

  it('refreshes again for a request that started after the last refresh', async () => {
    let calls = 0;
    let clock = 1_000;
    const storage = memoryStorage();
    const refreshSession = createSessionRefresher({
      refresh: async () => {
        calls++;
        return true;
      },
      storage,
      now: () => clock,
    });

    await refreshSession(clock);
    clock += 15 * 60_000;
    await refreshSession(clock);
    expect(calls).toBe(2);
  });

  it('reports failure, without recording a refresh, when the refresh token is rejected', async () => {
    const storage = memoryStorage();
    const refreshSession = createSessionRefresher({ refresh: async () => false, storage });
    await expect(refreshSession(1)).resolves.toBe(false);
    expect(storage.getItem(REFRESHED_AT_KEY)).toBeNull();
  });

  it('reports failure when the refresh request throws, and allows a later attempt', async () => {
    let attempt = 0;
    const refreshSession = createSessionRefresher({
      refresh: async () => {
        attempt++;
        if (attempt === 1) throw new Error('network');
        return true;
      },
      storage: memoryStorage(),
    });
    await expect(refreshSession(1)).resolves.toBe(false);
    await expect(refreshSession(2)).resolves.toBe(true);
  });
});
