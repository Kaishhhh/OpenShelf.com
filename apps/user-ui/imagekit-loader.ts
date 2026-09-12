import type { ImageLoaderProps } from 'next/image';

/**
 * Turns a stored ImageKit URL into a transformed one at request time.
 *
 * Stored URLs are always the bare, canonical form — `canonicalFileUrl` in
 * @openshelf/imagekit strips any query before persisting, precisely so `?tr=` can be
 * appended here. Nothing transformed is ever written to the database.
 *
 * Registered as `images.loaderFile`, so it replaces Next's own optimizer entirely: the
 * browser fetches the resized image straight from ImageKit's CDN rather than having Next
 * download and re-encode the original.
 */
export default function imagekitLoader({
  src,
  width,
  quality,
}: ImageLoaderProps): string {
  const transform = [
    `w-${width}`,
    // Scale to the requested width without distorting or cropping.
    'c-maintain_ratio',
    `q-${quality ?? 75}`,
  ].join(',');

  // Defensive: a src that already carries a query would otherwise produce `??tr=`.
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}tr=${transform}`;
}
