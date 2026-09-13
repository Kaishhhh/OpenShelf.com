/**
 * Where to send a visitor back to after they log in.
 *
 * `returnTo` arrives from the URL, so it is attacker-controlled: an unchecked value
 * would turn the login page into an open redirect that sends a just-authenticated user
 * to someone else's site. Only a path on this origin survives.
 */
const DEFAULT_RETURN_TO = '/';

export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) {
    return DEFAULT_RETURN_TO;
  }

  // '//evil.com' and '/\evil.com' are both protocol-relative URLs that a browser
  // resolves off-origin despite the leading slash.
  if (raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_RETURN_TO;
  }

  return raw;
}

/** Builds the login URL that will come back to `path`. */
export function loginUrl(path: string): string {
  return `/login?returnTo=${encodeURIComponent(path)}`;
}
