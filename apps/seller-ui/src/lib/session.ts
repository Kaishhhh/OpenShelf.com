/**
 * Silent session refresh.
 *
 * Access tokens last 15 minutes; the refresh token lasts a week and **rotates** on every
 * use, with reuse detection: presenting a refresh token that was already rotated revokes
 * every session the account has. That makes concurrency the whole problem:
 *
 * - Five requests in one tab all 401 at once → one refresh, not five. (In-tab single
 *   flight: every caller awaits the same promise.)
 * - Two tabs both 401 at once → one refresh, not two. Cookies are shared, so the second
 *   tab must not rotate again. (Cross-tab: the Web Locks API serialises the refresh, and a
 *   timestamp in localStorage tells the tab that waited that the other one already did it.)
 *
 * A request that 401s passes the time it started. If a refresh completed after that, the
 * cookie it was sent with is simply stale, and retrying is enough.
 */

export const REFRESH_LOCK_NAME = 'openshelf-session-refresh';
export const REFRESHED_AT_KEY = 'openshelf:session-refreshed-at';

export interface RefresherDeps {
  refresh: () => Promise<boolean>;
  locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}

export function createSessionRefresher(deps: RefresherDeps) {
  const now = deps.now ?? Date.now;
  let inFlight: Promise<boolean> | null = null;

  function lastRefreshedAt(): number {
    try {
      return Number(deps.storage?.getItem(REFRESHED_AT_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  }

  function markRefreshed(): void {
    try {
      deps.storage?.setItem(REFRESHED_AT_KEY, String(now()));
    } catch {
      // Storage unavailable (private mode): only cross-tab dedupe is lost.
    }
  }

  async function refreshOnce(requestStartedAt: number): Promise<boolean> {
    if (lastRefreshedAt() >= requestStartedAt) {
      return true;
    }
    const ok = await deps.refresh();
    if (ok) {
      markRefreshed();
    }
    return ok;
  }

  /**
   * Resolves true when the session is (now) fresh and the failed request should be
   * retried, false when it cannot be refreshed — the caller is logged out.
   */
  return function refreshSession(requestStartedAt: number = now()): Promise<boolean> {
    inFlight ??= (
      deps.locks
        ? deps.locks.request(REFRESH_LOCK_NAME, () => refreshOnce(requestStartedAt))
        : refreshOnce(requestStartedAt)
    )
      .catch(() => false)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

// seller-service's auth routes sit at the root of the gateway's /seller mount.
const AUTH_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/seller';

/** The browser's refresher. Safe to import during SSR; it only touches browser APIs when called. */
export const refreshSession = createSessionRefresher({
  refresh: async () => {
    const res = await fetch(`${AUTH_BASE_URL}/refresh-token`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  },
  get locks() {
    return typeof navigator !== 'undefined' && 'locks' in navigator
      ? (navigator.locks as RefresherDeps['locks'])
      : undefined;
  },
  get storage() {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  },
});
