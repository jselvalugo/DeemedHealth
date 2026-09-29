/**
 * Signing for the demo's cookies (NON-PRODUCTION ONLY). The key is derived from
 * DH_DEV_ROOT_KEY when it is set, or is random per server process (then a restart or a
 * second instance simply drops older demo cookies, which is fine for a demo). Every MAC
 * binds a purpose and the signed-in demo user id, so a value cannot move between users
 * or between cookies.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

let cached: Buffer | null = null;

function demoKey(): Buffer {
  if (cached) return cached;
  const root = process.env.DH_DEV_ROOT_KEY;
  cached = root
    ? createHmac('sha256', root).update('deemed-health/demo-cookies/v1').digest()
    : randomBytes(32);
  return cached;
}

/** For tests: forget the derived key (a new DH_DEV_ROOT_KEY takes effect). */
export function resetDemoKey(): void {
  cached = null;
}

function mac(purpose: string, userId: string, payload: string): string {
  return createHmac('sha256', demoKey())
    .update(`${purpose}\u0000${userId}\u0000${payload}`)
    .digest('base64url');
}

/** `<payload>.<mac>`; the payload must not contain a dot (base64url and digits never do). */
export function signValue(purpose: string, userId: string, payload: string): string {
  return `${payload}.${mac(purpose, userId, payload)}`;
}

/** The payload when the MAC is valid for this purpose and user, otherwise null. */
export function verifyValue(
  purpose: string,
  userId: string,
  value: string | undefined,
): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'utf8');
  const expected = Buffer.from(mac(purpose, userId, payload), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return payload;
}
