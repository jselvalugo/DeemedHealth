// Cookie names and options for the non-production demo session (auth-stub.ts).
// Real sessions are server-side in apps/api (ADR-0006 §4); these cookies hold only
// a synthetic demo user id and are never honored when DH_ENV=production.
export const SESSION_COOKIE = 'dh_demo_session';
export const PENDING_COOKIE = 'dh_demo_pending';
/** Records demo: the signed change journal and the signed step-up (records-demo/). */
export const DEMO_JOURNAL_COOKIE = 'dh_demo_records';
export const DEMO_STEP_UP_COOKIE = 'dh_demo_stepup';
/** Cookies that belong to one demo session: cleared on sign-in and sign-out. */
export const DEMO_SESSION_SCOPED_COOKIES = [DEMO_JOURNAL_COOKIE, DEMO_STEP_UP_COOKIE] as const;

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
