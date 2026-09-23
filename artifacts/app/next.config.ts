import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  // The Replit preview proxies through an iframe on a different origin.
  allowedDevOrigins: ['*.replit.dev', '*.repl.co', '*.replit.app', 'localhost'],
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
  serverExternalPackages: ['@prisma/client', 'pg'],
};

export default nextConfig;
