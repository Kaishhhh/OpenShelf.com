import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const APP_NAME = 'openshelf';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * The service account, from a base64-encoded JSON blob in the environment rather than a
 * file on disk — nothing to mount, and nothing to accidentally commit.
 *
 * Errors name the variable and never include its value: it holds a private key.
 */
function serviceAccount(): Record<string, string> {
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT_BASE64');
  let json: string;
  try {
    json = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64');
  }
  try {
    const parsed = JSON.parse(json) as Record<string, string>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('missing fields');
    }
    return parsed;
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_BASE64 does not decode to a service account JSON (project_id, client_email, private_key)'
    );
  }
}

let app: App | undefined;

/**
 * The Firebase Admin app, built on first use rather than at import time — the same
 * reasoning as @openshelf/stripe and @openshelf/kafka. A service without Firebase
 * credentials still boots; the first push fails loudly with the variable named.
 *
 * A named app, so this never collides with a default app something else initialised.
 */
export function firebase(): App {
  app ??=
    getApps().find((existing) => existing.name === APP_NAME) ??
    initializeApp({ credential: cert(serviceAccount()) }, APP_NAME);
  return app;
}

/** For tests: forget the memoised app so a changed environment is re-read. */
export function resetFirebaseForTests(): void {
  app = undefined;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Absolute URL opened when the notification is clicked. */
  link?: string;
  /** String-only key/values delivered alongside, for the client's own handling. */
  data?: Record<string, string>;
}

export interface PushResult {
  successCount: number;
  failureCount: number;
  /**
   * Tokens FCM says will never work again — the app was uninstalled, the browser
   * unsubscribed, or the token is malformed. The caller should delete them, or they
   * accumulate forever and every send pays for them.
   */
  invalidTokens: string[];
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Whether an FCM send error means the token itself is dead, not that the send failed. */
export function isDeadTokenError(error: { code?: string } | undefined): boolean {
  return error?.code !== undefined && DEAD_TOKEN_CODES.has(error.code);
}

/**
 * Sends one notification to every token, as a web push.
 *
 * Resolves with per-token outcomes rather than throwing on individual failures — FCM
 * reports those per token. It rejects only when the whole request fails (credentials,
 * network), which the caller logs.
 */
export async function sendPush(tokens: string[], message: PushMessage): Promise<PushResult> {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const response = await getMessaging(firebase()).sendEachForMulticast({
    tokens: unique,
    notification: { title: message.title, body: message.body },
    data: message.data,
    webpush: message.link ? { fcmOptions: { link: message.link } } : undefined,
  });

  const invalidTokens = response.responses.flatMap((result, index) =>
    !result.success && isDeadTokenError(result.error) ? [unique[index]] : []
  );

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
}
