import { Resend } from 'resend';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let client: Resend | undefined;

/**
 * The configured client, built on first use rather than at import time.
 *
 * @openshelf/redis constructs its client eagerly, but doing that here would stop
 * auth-service and seller-service booting for anyone without a Resend key — including
 * every route that never sends mail, and login in particular. Deferring it keeps the
 * services startable, and sendOtpEmail turns the eventual throw into a logged failure
 * rather than a broken registration.
 *
 * The memo is only assigned on success, so a call made before the environment is
 * configured does not poison every later one.
 */
export function resend(): Resend {
  client ??= new Resend(requireEnv('RESEND_API_KEY'));
  return client;
}

/** The verified sender, e.g. `OpenShelf <onboarding@resend.dev>`. */
export function emailFrom(): string {
  return requireEnv('EMAIL_FROM');
}
