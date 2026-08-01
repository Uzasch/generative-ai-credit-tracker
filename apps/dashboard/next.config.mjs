/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@token-tracker/shared', '@token-tracker/convex'],
};

export default nextConfig;
