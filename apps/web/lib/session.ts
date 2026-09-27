// Server-only helpers to read the current session (API or demo stub) and locale.
import { cookies } from 'next/headers';
import {
  PermissionSchema,
  isProduction,
  permissionsFor,
  type NavigationResponse,
  type Permission,
  type RoleId,
} from '@deemed/domain';
import { toLocale, type Locale } from '@deemed/i18n';
import { DEMO_TENANT, findDemoUserById } from './auth-demo';
import { authMode, type AuthMode } from './auth-mode';
import { fetchMe, fetchNavigation } from './api-server';
import { PENDING_COOKIE, SESSION_COOKIE } from './session-cookies';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: RoleId[];
  tenant: { id: string; name: string };
  permissions: ReadonlySet<Permission>;
  mode: AuthMode;
  /** API mode only: send as x-csrf-token on mutations. */
  csrfToken?: string;
};

export type SessionLookup =
  { user: SessionUser; reason?: undefined } | { user: null; reason: 'none' | 'expired' };

/** The signed-in user, from apps/api (or the demo stub where that is allowed). */
export async function getSession(): Promise<SessionLookup> {
  if (authMode() === 'stub') {
    if (isProduction(process.env.DH_ENV)) return { user: null, reason: 'none' };
    const user = findDemoUserById((await cookies()).get(SESSION_COOKIE)?.value);
    if (!user || user.locked) return { user: null, reason: 'none' };
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        tenant: DEMO_TENANT,
        permissions: permissionsFor(user.roles),
        mode: 'stub',
      },
    };
  }
  const me = await fetchMe();
  if (!me.ok) return { user: null, reason: me.code === 'session_expired' ? 'expired' : 'none' };
  const permissions = new Set(
    me.data.permissions.filter((p): p is Permission => PermissionSchema.safeParse(p).success),
  );
  return {
    user: {
      id: me.data.user.userAccountId,
      name: me.data.user.displayName,
      email: me.data.user.email,
      roles: me.data.roles,
      tenant: me.data.organization,
      permissions,
      mode: 'api',
      csrfToken: me.data.csrfToken,
    },
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getSession()).user;
}

/** API mode: the launcher as the API's policy computed it (null in stub mode). */
export async function getNavigation(): Promise<NavigationResponse | null> {
  if (authMode() === 'stub') return null;
  const nav = await fetchNavigation();
  return nav.ok ? nav.data : { modules: [] };
}

/** True while a sign-in is between the password and the second factor. */
export async function hasPendingSignIn(): Promise<boolean> {
  const jar = await cookies();
  if (authMode() === 'api') return jar.has('__Host-dh_signin') || jar.has('dh_signin');
  if (isProduction(process.env.DH_ENV)) return false;
  return Boolean(findDemoUserById(jar.get(PENDING_COOKIE)?.value));
}

export async function getLocale(): Promise<Locale> {
  return toLocale((await cookies()).get('dh_lang')?.value);
}
