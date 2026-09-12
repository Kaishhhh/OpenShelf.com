import { getUploadAuth } from './api';

/** ImageKit's V1 upload endpoint, the same one the server SDK posts to. */
const UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';

/** Mirrors MAX_IMAGE_BYTES in product-service. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Mirrors MAX_PRODUCT_IMAGES in product-service. */
export const MAX_PRODUCT_IMAGES = 8;

export interface UploadedFile {
  fileId: string;
  url: string;
}

/**
 * Why a file cannot be uploaded, or null when it can.
 *
 * These mirror the server's checks so the seller hears about a 6MB photo before
 * spending a minute sending it, not after. The server still enforces all three
 * — it re-fetches the file from ImageKit and checks the real size — so this is
 * convenience, never the control.
 */
export function rejectionReason(file: File, existingCount: number): string | null {
  if (existingCount >= MAX_PRODUCT_IMAGES) {
    return `A product can have at most ${MAX_PRODUCT_IMAGES} images`;
  }
  if (!file.type.startsWith('image/')) {
    return 'That file is not an image';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `Image must be at most ${MAX_IMAGE_BYTES / 1024 / 1024}MB (that one is ${mb}MB)`;
  }
  return null;
}

/**
 * Uploads a file straight from the browser to ImageKit.
 *
 * The private key never comes near this: the server mints a short-lived
 * signature and hands back the four form fields ImageKit wants. There is
 * deliberately no Authorization header — that is the server-side private-key
 * path, and sending one from a browser would mean the key had leaked.
 *
 * Uses XMLHttpRequest rather than fetch purely for `upload.onprogress`: fetch
 * still cannot report upload progress, and these requests are slow enough on a
 * phone connection that a silent wait reads as a hang.
 */
export async function uploadToImageKit(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadedFile> {
  // Fetched per file: the token is single-use and expires within the hour.
  const auth = await getUploadAuth();

  const form = new FormData();
  form.append('file', file);
  form.append('fileName', file.name);
  form.append('publicKey', auth.publicKey);
  form.append('signature', auth.signature);
  form.append('expire', String(auth.expire));
  form.append('token', auth.token);

  return new Promise<UploadedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', UPLOAD_URL);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body: { fileId?: string; url?: string; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the status check with an empty body.
      }

      if (xhr.status !== 200 || !body.fileId || !body.url) {
        reject(new Error(body.message ?? `Upload failed (${xhr.status})`));
        return;
      }

      resolve({ fileId: body.fileId, url: body.url });
    };

    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));

    xhr.send(form);
  });
}
