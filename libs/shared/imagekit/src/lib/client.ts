import ImageKit from 'imagekit';
import type { FileObject } from 'imagekit/dist/libs/interfaces/index.js';

export type ImageKitFile = FileObject;

export interface UploadAuthParams {
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
 * Short-lived parameters that let a browser upload straight to ImageKit.
 *
 * `signature` is an HMAC of token+expire keyed by the private key — the key is
 * an input to it, never part of the output. The return type is written out in
 * full and the object is built field by field so that a future SDK release
 * adding a fourth field can't silently widen what we hand to a client.
 */
export function getUploadAuth(): UploadAuthParams {
  const { token, expire, signature } = imagekit().getAuthenticationParameters();
  return { token, expire, signature };
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
    if (statusOf(err) === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Deletes a file. A file that is already gone counts as success: treating that
 * as an error would strand the database row that points at it, since callers
 * delete remotely before removing the row.
 */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    await imagekit().deleteFile(fileId);
  } catch (err) {
    if (statusOf(err) === 404) {
      return;
    }
    throw err;
  }
}
