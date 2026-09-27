/**
 * Synthetic demo identities for NON-PRODUCTION previews only (ADR-0009: synthetic
 * data only). There is no real identity provider yet (ADR-0006 is not built).
 *
 * Every function that reads demo data calls `assertDemoAllowed()`, which THROWS
 * when DH_ENV is "production", so a misrouted call can never sign anyone in there.
 * The server actions in auth-stub.ts also return "not implemented" in production
 * before they reach this module (defense in depth).
 */
import { isProduction, type RoleId } from '@deemed/domain';
import type { AuthErrorCode } from './auth-types';

export const DEMO_TENANT = { id: 'tenant-xyz-chc', name: 'XYZ Community Health Center' } as const;

export type DemoUser = {
  id: string;
  email: string;
  name: string;
  roles: RoleId[];
  locked?: boolean;
};

// Reserved `.test` domain (RFC 2606): these addresses can never reach a real inbox.
const DEMO_USERS: readonly DemoUser[] = [
  {
    id: 'demo-compliance',
    email: 'demo@xyz-chc.test',
    name: 'Dana Rivera',
    roles: ['compliance_officer'],
  },
  {
    id: 'demo-coordinator',
    email: 'coordinator@xyz-chc.test',
    name: 'Luis Moreno',
    roles: ['credentialing_coordinator'],
  },
  {
    id: 'demo-board',
    email: 'board@xyz-chc.test',
    name: 'Grace Whitfield',
    roles: ['board_member'],
  },
  {
    id: 'demo-locked',
    email: 'locked@xyz-chc.test',
    name: 'Pat Locked',
    roles: ['staff_provider'],
    locked: true,
  },
];

/** The one-time code every demo user's "authenticator" shows. */
export const DEMO_TOTP_CODE = '000000';
/** The demo recovery code (format of a real one: two groups of four). */
export const DEMO_RECOVERY_CODE = 'DEMO-CODE';
/** ADR-0006 §2: local passwords are at least 12 characters. */
export const MIN_PASSWORD_LENGTH = 12;

export class DemoInProductionError extends Error {
  constructor() {
    super('Synthetic demo sign-in is disabled when DH_ENV=production (ADR-0009).');
    this.name = 'DemoInProductionError';
  }
}

export function assertDemoAllowed(env: string | undefined = process.env.DH_ENV): void {
  if (isProduction(env)) throw new DemoInProductionError();
}

export function findDemoUserByEmail(email: string): DemoUser | undefined {
  assertDemoAllowed();
  const e = email.trim().toLowerCase();
  return DEMO_USERS.find((u) => u.email === e);
}

export function findDemoUserById(id: string | undefined): DemoUser | undefined {
  assertDemoAllowed();
  return id ? DEMO_USERS.find((u) => u.id === id) : undefined;
}

export function checkDemoPassword(
  email: string,
  password: string,
): { ok: true; user: DemoUser } | { ok: false; code: AuthErrorCode } {
  const user = findDemoUserByEmail(email);
  // Same generic error for unknown users and wrong passwords (ADR-0006 §11).
  if (!user) return { ok: false, code: 'invalid_credentials' };
  if (user.locked) return { ok: false, code: 'locked' };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: 'invalid_credentials' };
  return { ok: true, user };
}

export function checkDemoTotp(code: string): boolean {
  assertDemoAllowed();
  return code === DEMO_TOTP_CODE;
}

export function checkDemoRecoveryCode(code: string): boolean {
  assertDemoAllowed();
  return normalizeRecoveryCode(code) === DEMO_RECOVERY_CODE;
}

// ---- Validation (pure; used in every environment) ----

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): AuthErrorCode | undefined {
  const v = value.trim();
  if (!v) return 'email_required';
  if (v.length > 254 || !EMAIL.test(v)) return 'email_invalid';
  return undefined;
}

export function validateTotp(value: string): AuthErrorCode | undefined {
  const v = value.replace(/\s/g, '');
  if (!v) return 'code_required';
  if (!/^\d{6}$/.test(v)) return 'code_format';
  return undefined;
}

export function normalizeRecoveryCode(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}
