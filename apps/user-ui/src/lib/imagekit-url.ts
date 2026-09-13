/**
 * Composes an ImageKit transformation onto a stored URL.
 *
 * Stored URLs are always the bare, canonical form — `canonicalFileUrl` in
 * @openshelf/imagekit strips any query before persisting, precisely so `?tr=` can be
 * appended here. Nothing transformed is ever written to the database.
 *
 * The single place transformations are built: the next/image loader delegates to it for
 * every <Image>, and generateMetadata calls it for og:image. Lives under src/ because
 * the loader file itself sits outside this tsconfig's rootDir and so cannot be imported
 * by application code.
 */
export function imagekitUrl({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
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
