//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Both libs ship raw TS/TSX from src/, so Next has to compile them itself.
  transpilePackages: ['@openshelf/ui', '@openshelf/types'],
  images: {
    // Every product image is an ImageKit URL, so the loader is global rather
    // than a per-<Image> prop that a new component could forget to pass.
    loaderFile: './imagekit-loader.ts',
    // Documentation more than enforcement: with a custom loader Next never
    // fetches the image itself, so it does not consult this list. Kept so the
    // allowed host is written down, and so removing the loader fails loudly
    // rather than silently proxying anything.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ik.imagekit.io',
      },
    ],
  },
};

module.exports = nextConfig;
