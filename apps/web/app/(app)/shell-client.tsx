'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import type { Locale } from '@deemed/i18n';
import { AppShell, type AppShellProps } from '@deemed/ui';
import { signOut } from '../../lib/auth-stub';
import { setLocaleCookie } from '../../lib/locale-client';

type Props = Pick<AppShellProps, 'locale' | 'modules' | 'user' | 'tenant' | 'homeHref'> & {
  children: ReactNode;
};

/** Connects the framework-free AppShell to Next.js routing, cookies, and actions. */
export function ShellClient({ children, ...props }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  return (
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
      onSignOut={() => startTransition(() => signOut())}
    >
      {children}
    </AppShell>
  );
}
