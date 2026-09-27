import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

// Netlify hosts non-production only (ADR-0009). Refuse a production build there.
if (process.env.NETLIFY === 'true' && process.env.DH_ENV === 'production') {
  throw new Error('DH_ENV=production is not allowed on Netlify (ADR-0009).');
}

// The API origin for server-side calls (lib/api-server.ts). On Netlify, netlify.toml
// passes the deploy URL at build time; locally, apps/api listens on its own port.
const apiUrl =
  process.env.DH_API_URL ?? (process.env.DH_ENV === 'local' ? 'http://localhost:4000' : '');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  env: { DH_API_URL: apiUrl },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Local development only: the browser calls /api/* on the web origin (same-origin
  // cookies), and Next forwards it to apps/api. Netlify serves /api/* with the function.
  async rewrites() {
    return process.env.DH_ENV === 'local' && apiUrl
      ? [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]
      : [];
  },
};

export default nextConfig;
