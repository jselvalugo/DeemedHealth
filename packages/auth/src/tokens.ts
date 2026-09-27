/**
 * Opaque bearer tokens for the session and pending sign-in cookies (ADR-0010 section 6).
 *
 * Format: `v1.<organizationId>.<256 random bits, base64url>`. The organization id lets
 * the API open the tenant transaction before it looks the token up under RLS; a forged
 * id only makes the lookup miss. Only SHA-256(token) is stored.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const SECRET_BYTES = 32;

export interface IssuedToken {
  token: string;
  hash: Buffer;
}

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Lowercase canonical UUID check without a regex. */
export function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const c = value.charCodeAt(i);
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== 45) return false;
    } else if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) {
      return false;
    }
  }
  return true;
}

function isBase64Url(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const ok =
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
    if (!ok) return false;
  }
  return true;
}

export function issueToken(organizationId: string): IssuedToken {
  if (!isUuid(organizationId)) throw new Error('organizationId must be a lowercase UUID');
  const token = `${VERSION}.${organizationId}.${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

/** Splits a presented token; null for anything malformed (never throws). */
export function parseToken(
  token: string | undefined,
): { organizationId: string; hash: Buffer } | null {
  if (!token || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, organizationId, secret] = parts as [string, string, string];
  if (version !== VERSION || !isUuid(organizationId)) return null;
  if (secret.length !== 43 || !isBase64Url(secret)) return null;
  return { organizationId, hash: sha256(token) };
}

/**
 * Per-session CSRF token (ADR-0010 section 1): derived from the session token, so it
 * needs no storage and changes when the session rotates. The browser receives it in
 * the body of GET /api/me and sends it back as `x-csrf-token`.
 */
export function csrfTokenFor(sessionToken: string): string {
  return sha256(`csrf|${sessionToken}`).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
