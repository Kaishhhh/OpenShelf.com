import ImageKit from 'imagekit';
import type { FileObject } from 'imagekit/dist/libs/interfaces/index.js';

export type ImageKitFile = FileObject;

export interface UploadAuthParams {
  publicKey: string;
  token: string;
  expire: number;
  signature: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let client: ImageKit | undefined;

/**
 * The configured client, built on first use rather than at import time.
 *
 * @openshelf/redis constructs its client eagerly, but doing that here would
 * stop product-service booting for anyone without ImageKit credentials, even
 * on the routes that never touch an image. Deferring it keeps the service
 * startable and still fails loudly — with a named variable — the first time an
 * image endpoint is actually hit unconfigured.
 */
export function imagekit(): ImageKit {
  client ??= new ImageKit({
    publicKey: requireEnv('IMAGEKIT_PUBLIC_KEY'),
    privateKey: requireEnv('IMAGEKIT_PRIVATE_KEY'),
    urlEndpoint: requireEnv('IMAGEKIT_URL_ENDPOINT'),
  });
  return client;
}

function statusOf(err: unknown): number | undefined {
  const meta = (err as { $ResponseMetadata?: { statusCode?: number } })
    ?.$ResponseMetadata;
  return meta?.statusCode;
}

/**
 * Whether a rejection means "there is no such file here".
 *
 * ImageKit splits that outcome across two status codes, which is easy to get
 * wrong: a fileId that is not 24 hex characters is rejected as malformed with
 * 400 ("Your request contains invalid fileId parameter."), while a well-formed
 * id that names nothing gives 404 ("The requested file does not exist.").
 *
 * Callers here only ever ask about an id that arrived from a client, so both
 * answers mean the same thing — the id does not name a file in this account —
 * and treating only 404 as absent leaves the 400 to surface as an opaque 500.
 */
function isMissingFile(err: unknown): boolean {
  const status = statusOf(err);
  return status === 404 || status === 400;
}

/**
 * The SDK rejects with a plain object ({ message, help, $ResponseMetadata }),
 * not an Error — so it carries no stack and reads as "{}" in most logs. Genuine
 * failures are re-thrown through this to become something a caller can catch,
 * log and assert on normally.
 */
function asError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  const status = statusOf(err);
  const message = (err as { message?: unknown } | null)?.message;
  const wrapped = new Error(
    `ImageKit request failed${status ? ` (${status})` : ''}: ${
      typeof message === 'string' ? message : JSON.stringify(err)
    }`
  );
  return Object.assign(wrapped, { $ResponseMetadata: { statusCode: status } });
}

/**
 * The stable form of a file's URL: origin and path, with any query dropped.
 *
 * The upload API and the media API disagree about this. An upload responds with
 * a bare url, while getFileDetails appends a `?updatedAt=<ms>` cache-buster
 * that changes every time the file is touched — so the two are never equal as
 * strings even for the same file, and neither is stable over time.
 *
 * This is also the form worth persisting: transformations are applied by
 * appending `?tr=...`, which a stored `?updatedAt=` would turn into a
 * second-parameter case that callers have to special-case.
 *
 * Returns null when the input will not parse as a URL.
 */
export function canonicalFileUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Everything a browser needs to upload straight to ImageKit.
 *
 * `signature` is an HMAC of token+expire keyed by the private key — the key is
 * an input to it, never part of the output. `publicKey` is deliberately here:
 * ImageKit's upload endpoint takes it as a form field, so a browser cannot
 * upload without it, and it is non-secret by design.
 *
 * The return type is written out in full and the object is built field by field
 * so that a future SDK release adding a field can't *silently* widen what we
 * hand to a client. Adding one here is a deliberate act, and the specs assert
 * the exact key set to keep it that way.
 */
export function getUploadAuth(): UploadAuthParams {
  const { token, expire, signature } = imagekit().getAuthenticationParameters();
  return {
    publicKey: requireEnv('IMAGEKIT_PUBLIC_KEY'),
    token,
    expire,
    signature,
  };
}

/**
 * Fetches a file's details, or null when no such file exists.
 *
 * The request authenticates with this account's private key, so a fileId
 * belonging to some other ImageKit account is indistinguishable from one that
 * was invented — both come back null. That is what makes this usable as a
 * check on a fileId supplied by a client.
 */
export async function getFileById(
  fileId: string
): Promise<ImageKitFile | null> {
  try {
    return await imagekit().getFileDetails(fileId);
  } catch (err) {
    if (isMissingFile(err)) {
      return null;
    }
    throw asError(err);
  }
}

/**
 * Deletes a file. A file that is already gone — or whose id ImageKit will not
 * even parse — counts as success: treating either as an error would strand the
 * database row that points at it, since callers delete remotely before removing
 * the row, and no retry could ever clear it.
 */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    await imagekit().deleteFile(fileId);
  } catch (err) {
    if (isMissingFile(err)) {
      return;
    }
    throw asError(err);
  }
}
