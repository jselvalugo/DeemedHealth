import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { t } from '@deemed/i18n';
import { homeRoute, launcherModules } from '@deemed/ui';
import { getCurrentUser, getLocale } from '../../lib/session';
import { ShellClient } from './shell-client';

/** The authenticated shell. Everything under (app) requires a session. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  const locale = await getLocale();
  // Navigation shows only what the user's roles allow; apps/api still enforces access.
  const modules = launcherModules(user.permissions);
  const primaryRole = user.roles[0];

  return (
    <ShellClient
      locale={locale}
      modules={modules}
      homeHref={homeRoute(user.permissions) ?? '/no-permission'}
      tenant={{ name: user.tenant.name }}
      user={{
        name: user.name,
        email: user.email,
        roleLabel: primaryRole ? t(locale, `role.${primaryRole}.name`) : '',
      }}
    >
      {children}
    </ShellClient>
  );
}
