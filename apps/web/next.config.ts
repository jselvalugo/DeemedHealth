import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

// Netlify hosts non-production only (ADR-0009). Refuse a production build there.
if (process.env.NETLIFY === 'true' && process.env.DH_ENV === 'production') {
  throw new Error('DH_ENV=production is not allowed on Netlify (ADR-0009).');
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
