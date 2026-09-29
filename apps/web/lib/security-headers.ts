// Security headers for every response (ADR-0009). Also mirrored in netlify.toml
// for static assets served by the CDN.
const isDev = process.env.NODE_ENV !== 'production';

// TODO(platform-devops-engineer): move to nonce-based script-src when middleware lands.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Every response. */
export const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/**
 * Sign-in pages send no Referer at all, so nothing typed or carried on them (a pending
 * sign-in, an MFA setup step) reaches another origin or a log through that header.
 * Later rules win in Next.js, so these follow the global ones.
 */
export const AUTH_PAGE_SOURCES = ['/sign-in', '/sign-in/:path*'] as const;
export const authPageHeaders = [{ key: 'Referrer-Policy', value: 'no-referrer' }];

export function headerRules() {
  return [
    { source: '/:path*', headers: securityHeaders },
    ...AUTH_PAGE_SOURCES.map((source) => ({ source, headers: authPageHeaders })),
  ];
}
