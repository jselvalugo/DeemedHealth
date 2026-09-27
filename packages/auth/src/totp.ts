/**
 * TOTP (RFC 6238) through `otpauth`: SHA-1, 6 digits, 30-second period (what every
 * authenticator app supports), ±1 step of clock skew, and a replay guard: a code whose
 * time step is not newer than the last accepted one is refused.
 */
import { Secret, TOTP } from 'otpauth';

const PERIOD = 30;
const DIGITS = 6;
const ISSUER = 'Deemed Health';

export function newTotpSecret(): { base32: string; bytes: Buffer } {
  const secret = new Secret({ size: 20 });
  return { base32: secret.base32, bytes: Buffer.from(secret.bytes) };
}

function totp(secretBytes: Buffer, label = 'account'): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: new Secret({ buffer: new Uint8Array(secretBytes).buffer }),
  });
}

export function totpUri(secretBytes: Buffer, label: string): string {
  return totp(secretBytes, label).toString();
}

/** Six digits, checked with a loop. */
export function isTotpFormat(code: string): boolean {
  if (code.length !== DIGITS) return false;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / PERIOD);
}

/** The code an authenticator shows at `at` (tests and the software authenticator). */
export function generateTotp(secretBytes: Buffer, at: Date): string {
  return totp(secretBytes).generate({ timestamp: at.getTime() });
}

/**
 * Returns the accepted time step, or null. `lastStep` is the factor's last accepted
 * step; the same or an older step is a replay.
 */
export function verifyTotp(
  secretBytes: Buffer,
  code: string,
  at: Date,
  lastStep: number | null,
): number | null {
  const normalized = code.split(' ').join('');
  if (!isTotpFormat(normalized)) return null;
  const delta = totp(secretBytes).validate({
    token: normalized,
    timestamp: at.getTime(),
    window: 1,
  });
  if (delta === null) return null;
  const step = totpStep(at) + delta;
  if (lastStep !== null && step <= lastStep) return null;
  return step;
}
