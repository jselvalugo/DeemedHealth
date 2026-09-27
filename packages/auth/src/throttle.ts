/**
 * Sign-in throttling and progressive lockout (ADR-0006 rule 11). The state lives in
 * platform.auth_throttle behind the auth.throttle_* SECURITY DEFINER functions, which
 * apply the policy atomically on the database clock (migrations 0005-0006).
 * `recordFailure` and `isLocked` below are the reference model of that policy: pure,
 * taking `now`, and kept in step with the SQL by a database test.
 *
 * Keys are SHA-256 digests of `account:<lower-case email>` and `ip:<prefix>`, so an
 * unknown email is throttled exactly like a known one (no user enumeration) and no
 * raw email or address is stored.
 */
import { sha256 } from './tokens.js';
import { THROTTLE_POLICY } from './policy.js';

export type ThrottleScope = 'account' | 'ip';

export interface ThrottleState {
  failures: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
}

export interface ThrottleKey {
  scope: ThrottleScope;
  hash: Buffer;
}

export function accountKey(email: string): ThrottleKey {
  return { scope: 'account', hash: sha256(`account:${email.trim().toLowerCase()}`) };
}

/** IPv4: the address. IPv6: the /64 prefix (first four hextets). */
export function ipPrefix(ip: string): string {
  const bare = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!bare.includes(':')) return bare;
  return bare.split(':').slice(0, 4).join(':');
}

export function ipKey(ip: string): ThrottleKey {
  return { scope: 'ip', hash: sha256(`ip:${ipPrefix(ip)}`) };
}

/** Whether the key is locked at `now`. */
export function isLocked(state: ThrottleState | undefined, now: Date): boolean {
  return Boolean(state?.lockedUntil && state.lockedUntil.getTime() > now.getTime());
}

/**
 * State after one more failure. Failures count within a window; past the free
 * allowance each failure locks the key, doubling up to the cap:
 * account 1, 2, 4, ... 60 minutes; IP 15, 30, 60 minutes.
 */
export function recordFailure(
  scope: ThrottleScope,
  state: ThrottleState | undefined,
  now: Date,
): ThrottleState & { lockedNow: boolean } {
  const rule = THROTTLE_POLICY[scope];
  const windowMs = THROTTLE_POLICY.windowSeconds * 1000;
  const fresh =
    !state || (now.getTime() - state.windowStartedAt.getTime() > windowMs && !isLocked(state, now));
  const failures = (fresh ? 0 : state.failures) + 1;
  const windowStartedAt = fresh ? now : state.windowStartedAt;
  if (failures <= rule.freeFailures) {
    return {
      failures,
      windowStartedAt,
      lockedUntil: fresh ? null : state.lockedUntil,
      lockedNow: false,
    };
  }
  const exponent = Math.min(failures - rule.freeFailures - 1, 16);
  const seconds = Math.min(rule.baseLockSeconds * 2 ** exponent, rule.maxLockSeconds);
  return {
    failures,
    windowStartedAt,
    lockedUntil: new Date(now.getTime() + seconds * 1000),
    lockedNow: true,
  };
}
