/**
 * Local account passwords (ADR-0006 rule 2): Argon2id via @node-rs/argon2, at least
 * 12 characters, breached-list check, no composition rules, no forced rotation.
 */
import { hash, verify } from '@node-rs/argon2';
import { isBreachedPassword } from './breached-passwords.js';
import { PASSWORD_POLICY } from './policy.js';

/** OWASP Argon2id baseline: m=19 MiB, t=2, p=1. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export type PasswordProblem = 'too_short' | 'too_long' | 'breached' | 'contains_email';

/** Why a new password is not acceptable, or null. Never logs or returns the password. */
export function checkNewPassword(password: string, email?: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_POLICY.minLength) return 'too_short';
  if (length > PASSWORD_POLICY.maxLength) return 'too_long';
  if (isBreachedPassword(password)) return 'breached';
  const local = email?.split('@', 1)[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return 'contains_email';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = checkNewPassword(password);
  if (problem) throw new Error(`password rejected: ${problem}`);
  // @node-rs/argon2 defaults to Argon2id.
  return hash(password, ARGON2_OPTIONS);
}

/** A fixed hash to verify against when no account matches, so timing is the same. */
let dummyHash: Promise<string> | undefined;
function dummy(): Promise<string> {
  dummyHash ??= hash('dummy password for timing equalisation', ARGON2_OPTIONS);
  return dummyHash;
}

/** Verifies; with `phc` undefined it burns the same time and returns false. */
export async function verifyPassword(phc: string | undefined, password: string): Promise<boolean> {
  if (password.length > 1024) return false;
  if (phc === undefined) {
    await verify(await dummy(), password).catch(() => false);
    return false;
  }
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}
