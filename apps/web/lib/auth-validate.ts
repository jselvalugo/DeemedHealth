// Pure input checks shared by the sign-in forms in every mode (no demo data here).
import type { AuthErrorCode } from './auth-types';

/** A plausible email: one "@", no spaces, a dot in the domain. Checked without a regex. */
function looksLikeEmail(v: string): boolean {
  const at = v.indexOf('@');
  if (at <= 0 || at !== v.lastIndexOf('@') || at === v.length - 1) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) return false;
  }
  const domain = v.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export function validateEmail(value: string): AuthErrorCode | undefined {
  const v = value.trim();
  if (!v) return 'email_required';
  if (v.length > 254 || !looksLikeEmail(v)) return 'email_invalid';
  return undefined;
}

/** Removes spaces (people paste "123 456"). */
export function compactCode(value: string): string {
  return value.split(' ').join('').trim();
}

export function validateTotp(value: string): AuthErrorCode | undefined {
  const v = compactCode(value);
  if (!v) return 'code_required';
  if (v.length !== 6) return 'code_format';
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 48 || c > 57) return 'code_format';
  }
  return undefined;
}

export function normalizeRecoveryCode(value: string): string {
  return compactCode(value).toUpperCase();
}
