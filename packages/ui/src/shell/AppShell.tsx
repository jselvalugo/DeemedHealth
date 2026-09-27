'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t, type Locale } from '@deemed/i18n';
import { matchModule, type ModuleEntry } from '../module-registry.js';
import { Header } from './Header.js';
import { ModuleBar } from './ModuleBar.js';
import { ModuleLauncher } from './ModuleLauncher.js';
import type { LinkComponent, ShellTenant, ShellUser } from './types.js';

export type AppShellProps = {
  locale: Locale;
  /** Modules this user may open (launcherModules(permissions)). Drives launcher + bar. */
  modules: ModuleEntry[];
  pathname: string;
  user: ShellUser;
  tenant: ShellTenant;
  logoSrc: string;
  homeHref: string;
  LinkComponent: LinkComponent;
  onNavigate: (route: string) => void;
  onLocaleChange: (locale: Locale) => void;
  onSignOut: () => void;
  children: ReactNode;
};

/** White header + navy module bar + white canvas (design system §4). */
export function AppShell({
  locale,
  modules,
  pathname,
  user,
  tenant,
  logoSrc,
  homeHref,
  LinkComponent,
  onNavigate,
  onLocaleChange,
  onSignOut,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [focusModule, setFocusModule] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const current = matchModule(pathname, modules);
  const profileHref = modules.flatMap((m) => m.pages).find((p) => p.route === '/me')?.route;

  const openLauncher = useCallback((trigger: HTMLElement | null, moduleFirst: boolean) => {
    triggerRef.current = trigger;
    setFocusModule(moduleFirst);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const active = document.activeElement;
        openLauncher(active instanceof HTMLElement ? active : null, false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openLauncher]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <a
        href="#main"
        className="focus-ring sr-only z-50 rounded-control bg-white px-4 py-2 font-semibold text-navy-900 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        {t(locale, 'skip.main')}
      </a>
      <Header
        locale={locale}
        logoSrc={logoSrc}
        homeHref={homeHref}
        profileHref={profileHref}
        tenant={tenant}
        user={user}
        LinkComponent={LinkComponent}
        onOpenLauncher={(el) => openLauncher(el, false)}
        onLocaleChange={onLocaleChange}
        onSignOut={onSignOut}
      />
      <ModuleBar
        locale={locale}
        module={current?.module}
        activeRoute={current?.page.route}
        LinkComponent={LinkComponent}
        onOpenLauncher={(el) => openLauncher(el, true)}
      />
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 outline-none md:px-8"
      >
        {children}
      </main>
      <ModuleLauncher
        open={open}
        onOpenChange={setOpen}
        modules={modules}
        currentModuleId={current?.module.id}
        locale={locale}
        onNavigate={onNavigate}
        focusCurrentModule={focusModule}
        onClosed={(navigated) => {
          // After opening a page, move focus to the new content; otherwise return
          // focus to whatever opened the launcher (design system §4.3).
          const target = navigated ? mainRef.current : triggerRef.current;
          (target && target.isConnected ? target : mainRef.current)?.focus();
        }}
      />
    </div>
  );
}
