'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import type { Locale } from '@deemed/i18n';
import { AppShell, type AppShellProps } from '@deemed/ui';
import { apiPost } from '../../lib/api-browser';
import type { AuthMode } from '../../lib/auth-mode';
import { signOut } from '../../lib/auth-stub';
import { setLocaleCookie } from '../../lib/locale-client';
import { demoStepUp } from '../../lib/records-demo/client';
import { ApiProvider } from './reauth';
import { RecordsBridge } from './records-view';

type Props = Pick<AppShellProps, 'locale' | 'modules' | 'user' | 'tenant' | 'homeHref'> & {
  children: ReactNode;
  authMode: AuthMode;
  csrfToken: string | undefined;
};

/** Connects the framework-free AppShell to Next.js routing, cookies, and the API. */
export function ShellClient({ children, authMode, csrfToken, ...props }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const onSignOut = () =>
    authMode === 'api'
      ? void apiPost('/api/auth/logout', {}, csrfToken).then(() =>
          window.location.assign('/sign-in?reason=signed-out'),
        )
      : startTransition(() => signOut());

  return (
    <ApiProvider
      locale={props.locale as Locale}
      csrfToken={csrfToken}
      stepUp={authMode === 'stub' ? demoStepUp : undefined}
    >
      <AppShell
        {...props}
        pathname={pathname}
        logoSrc="/brand/deemed-health-logo.png"
        LinkComponent={Link}
        onNavigate={(route) => router.push(route)}
        onLocaleChange={(next: Locale) => {
          setLocaleCookie(next);
          router.refresh();
        }}
        onSignOut={onSignOut}
      >
        <RecordsBridge mode={authMode} locale={props.locale as Locale}>
          {children}
        </RecordsBridge>
      </AppShell>
    </ApiProvider>
  );
}
