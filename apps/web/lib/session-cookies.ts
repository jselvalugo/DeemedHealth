// Cookie names and options for the non-production demo session (auth-stub.ts).
// Real sessions are server-side in apps/api (ADR-0006 §4); these cookies hold only
// a synthetic demo user id and are never honored when DH_ENV=production.
export const SESSION_COOKIE = 'dh_demo_session';
export const PENDING_COOKIE = 'dh_demo_pending';

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Browsers accept Secure cookies on http://localhost; keep dev servers on other hosts working.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
