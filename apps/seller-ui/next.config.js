//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Both libs ship raw TS/TSX from src/, so Next has to compile them itself.
  transpilePackages: ['@openshelf/ui', '@openshelf/types'],
};

module.exports = nextConfig;
