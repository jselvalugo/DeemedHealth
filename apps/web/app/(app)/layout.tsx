import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { t } from '@deemed/i18n';
import { launcherModules } from '@deemed/ui';
import { modulesFromNavigation } from '../../lib/navigation';
import { getLocale, getNavigation, getSession } from '../../lib/session';
import { ShellClient } from './shell-client';

/**
 * The authenticated shell. Everything under (app) requires a session, checked here on
 * the server against apps/api (GET /api/me). The launcher comes from
 * /api/me/navigation, so it hides exactly what the API would deny.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session.user)
    redirect(session.reason === 'expired' ? '/sign-in?reason=expired' : '/sign-in');
  const user = session.user;
  const locale = await getLocale();
  const nav = await getNavigation();
  const modules = nav ? modulesFromNavigation(nav) : launcherModules(user.permissions);
  const primaryRole = user.roles[0];

  return (
    <ShellClient
      locale={locale}
      modules={modules}
      homeHref={modules[0]?.pages[0]?.route ?? '/no-permission'}
      tenant={{ name: user.tenant.name }}
      user={{
        name: user.name,
        email: user.email,
        roleLabel: primaryRole ? t(locale, `role.${primaryRole}.name`) : '',
      }}
      authMode={user.mode}
      csrfToken={user.csrfToken}
    >
      {children}
    </ShellClient>
  );
}
