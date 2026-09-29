/**
 * Cookie parsing and serialization for the session and pending sign-in cookies
 * (ADR-0006 rule 4: HttpOnly, Secure, SameSite=Lax, host-prefixed). Parsing uses
 * string splitting only (no regex over untrusted input).
 */

export interface CookieNames {
  session: string;
  signin: string;
}

export function cookieNames(secure: boolean): CookieNames {
  // The __Host- prefix requires Secure, Path=/ and no Domain.
  return secure
    ? { session: '__Host-dh_session', signin: '__Host-dh_signin' }
    : { session: 'dh_session', signin: 'dh_signin' };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header || header.length > 16_384) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, secure });
}
