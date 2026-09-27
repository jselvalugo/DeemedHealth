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
import { isIPv4, isIPv6 } from 'node:net';
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

/**
 * The eight 16-bit groups of a valid IPv6 address, or null. Expands `::`, drops a zone
 * (`%eth0`), and reads a dotted IPv4 tail (`64:ff9b::192.0.2.1`). Plain splits and
 * loops, no regular expressions.
 */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null;
  const zone = address.indexOf('%');
  let text = zone >= 0 ? address.slice(0, zone) : address;
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const o = last.split('.').map(Number);
    const hi = (((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16);
    const lo = (((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const side = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((h) => Number.parseInt(h, 16));
  const gap = text.indexOf('::');
  let groups: number[];
  if (gap >= 0) {
    const head = side(text.slice(0, gap));
    const tail = side(text.slice(gap + 2));
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = side(text);
  }
  if (groups.length !== 8) return null;
  for (const g of groups) if (!Number.isInteger(g) || g < 0 || g > 0xffff) return null;
  return groups;
}

/**
 * The client network a limit applies to. IPv4: the address. IPv6: the /64 prefix,
 * normalized (so every spelling of one network gives the same key: `2001:db8::1`,
 * `2001:DB8:0:0::2`, and the full form are all `2001:db8:0:0::/64`). IPv4-mapped IPv6
 * is the IPv4 address. Anything unparseable is returned unchanged.
 */
export function ipPrefix(ip: string): string {
  const address = ip.trim();
  if (isIPv4(address)) return address;
  const groups = ipv6Groups(address);
  if (!groups) return address;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const hi = groups[6] as number;
    const lo = groups[7] as number;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
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
