import type { ImageLoaderProps } from 'next/image';
import { imagekitUrl } from './src/lib/imagekit-url';

/**
 * Registered as `images.loaderFile`, so it replaces Next's own optimizer entirely: the
 * browser fetches the resized image straight from ImageKit's CDN rather than having Next
 * download and re-encode the original.
 *
 * A thin adapter on purpose — this path is fixed by next.config.js and sits outside the
 * app's tsconfig rootDir, so the actual logic lives in src/lib/imagekit-url.ts where
 * pages can also reach it.
 */
export default function imagekitLoader(props: ImageLoaderProps): string {
  return imagekitUrl(props);
}
