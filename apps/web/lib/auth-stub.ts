'use server';

/**
 * Sign-in server-action STUBS (Phase 1 slice S1: UI only).
 *
 * There is no identity backend yet: ADR-0006 (OIDC/SAML SSO, WebAuthn/TOTP MFA,
 * server-side sessions in apps/api) is built by backend-engineer in a later slice.
 *
 * - DH_ENV=production: every action returns { status: 'not_implemented' }. Nobody
 *   can sign in, and no demo code path is reachable.
 * - Outside the stub mode (authMode(): a non-production DH_ENV with no
 *   DATABASE_URL) every action also returns "not implemented"; apps/api is used.
 * - In the stub mode: synthetic demo users from auth-demo.ts can sign in so the
 *   shell can be reviewed. auth-demo.ts throws if it is ever called in production.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isProduction } from '@deemed/domain';
import {
  assertDemoAllowed,
  checkDemoPassword,
  checkDemoRecoveryCode,
  checkDemoTotp,
  findDemoUserByEmail,
  findDemoUserById,
  validateEmail,
  validateTotp,
} from './auth-demo';
import { authMode } from './auth-mode';
import type { AuthFormState } from './auth-types';
import { PENDING_COOKIE, SESSION_COOKIE, cookieOptions } from './session-cookies';

const NOT_IMPLEMENTED: AuthFormState = { status: 'not_implemented' };

/** The stub answers only where authMode() selects it (non-production, no database). */
function inProduction(): boolean {
  return isProduction(process.env.DH_ENV) || authMode() !== 'stub';
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

async function setPending(userId: string) {
  (await cookies()).set(PENDING_COOKIE, userId, cookieOptions(10 * 60)); // 10 minutes
}

async function startSession(userId: string) {
  const jar = await cookies();
  jar.delete(PENDING_COOKIE);
  jar.set(SESSION_COOKIE, userId, cookieOptions(12 * 60 * 60)); // ADR-0006 §4 absolute 12h
}

/** Step 1: email. Never reveals whether an account exists (ADR-0006 §11). */
export async function startSignIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, 'email').trim();
  const invalid = validateEmail(email);
  if (invalid) return { status: 'error', code: invalid, field: 'email' };
  if (inProduction()) return NOT_IMPLEMENTED;
  assertDemoAllowed();
  // Home-realm discovery by domain would decide `sso` here; the demo tenant offers both.
  return { status: 'method', email, sso: true };
}

/** Step 2a: local account password (ADR-0006 §2), then MFA. */
export async function signInWithPassword(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = field(form, 'email');
  const password = field(form, 'password');
  if (!password) return { status: 'error', code: 'password_required', field: 'password' };
  if (inProduction()) return NOT_IMPLEMENTED;
  const result = checkDemoPassword(email, password);
  if (!result.ok) return { status: 'error', code: result.code };
  await setPending(result.user.id);
  redirect('/sign-in/mfa');
}

/** Step 2b: SSO. The demo "IdP" does not assert MFA, so we step up (ADR-0006 §3). */
export async function signInWithSso(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (inProduction()) return NOT_IMPLEMENTED;
  const user = findDemoUserByEmail(field(form, 'email'));
  if (!user) return { status: 'error', code: 'invalid_credentials' };
  if (user.locked) return { status: 'error', code: 'locked' };
  await setPending(user.id);
  redirect('/sign-in/mfa');
}

async function pendingUser() {
  return findDemoUserById((await cookies()).get(PENDING_COOKIE)?.value);
}

/** Step 3a: authenticator (TOTP) code. */
export async function verifyMfaCode(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const code = field(form, 'code').replace(/\s/g, '');
  const invalid = validateTotp(code);
  if (invalid) return { status: 'error', code: invalid, field: 'code' };
  if (inProduction()) return NOT_IMPLEMENTED;
  const user = await pendingUser();
  if (!user) return { status: 'error', code: 'expired' };
  if (!checkDemoTotp(code)) return { status: 'error', code: 'code_invalid', field: 'code' };
  await startSession(user.id);
  redirect('/');
}

/** Step 3b: passkey. WebAuthn is not wired yet; the demo simulates a successful ceremony. */
export async function verifyPasskey(): Promise<AuthFormState> {
  if (inProduction()) return NOT_IMPLEMENTED;
  const user = await pendingUser();
  if (!user) return { status: 'error', code: 'expired' };
  await startSession(user.id);
  redirect('/');
}

/** Recovery code in place of the second factor. */
export async function redeemRecoveryCode(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = field(form, 'email').trim();
  const code = field(form, 'code');
  const invalidEmail = validateEmail(email);
  if (invalidEmail) return { status: 'error', code: invalidEmail, field: 'email' };
  if (!code.trim()) return { status: 'error', code: 'recovery_required', field: 'code' };
  if (inProduction()) return NOT_IMPLEMENTED;
  const user = findDemoUserByEmail(email);
  if (!user || !checkDemoRecoveryCode(code)) {
    return { status: 'error', code: 'recovery_invalid', field: 'code' };
  }
  if (user.locked) return { status: 'error', code: 'locked' };
  await startSession(user.id);
  redirect('/');
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PENDING_COOKIE);
  redirect('/sign-in?reason=signed-out');
}
