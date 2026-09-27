// Server-only helpers to read the current (demo) session and locale.
import { cookies } from 'next/headers';
import { isProduction, permissionsFor, type Permission, type RoleId } from '@deemed/domain';
import { toLocale, type Locale } from '@deemed/i18n';
import { DEMO_TENANT, findDemoUserById } from './auth-demo';
import { PENDING_COOKIE, SESSION_COOKIE } from './session-cookies';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: RoleId[];
  tenant: { id: string; name: string };
  permissions: ReadonlySet<Permission>;
};

/** The signed-in user, or null. Always null in production until real auth ships. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (isProduction(process.env.DH_ENV)) return null;
  const user = findDemoUserById((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user || user.locked) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    tenant: DEMO_TENANT,
    permissions: permissionsFor(user.roles),
  };
}

/** True while a sign-in is between the first and second step (demo only). */
export async function hasPendingSignIn(): Promise<boolean> {
  if (isProduction(process.env.DH_ENV)) return false;
  return Boolean(findDemoUserById((await cookies()).get(PENDING_COOKIE)?.value));
}

export async function getLocale(): Promise<Locale> {
  return toLocale((await cookies()).get('dh_lang')?.value);
}
