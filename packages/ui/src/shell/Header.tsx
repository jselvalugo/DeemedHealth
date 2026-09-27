'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Languages, LogOut, Search, UserRound, Building } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { LOCALES, t, type Locale } from '@deemed/i18n';
import { cn } from '../cn.js';
import { Keycap } from '../components/misc.js';
import type { LinkComponent, ShellTenant, ShellUser } from './types.js';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const noopSubscribe = () => () => {};
function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
}

/** `⌘ K` on Apple platforms, `Ctrl K` elsewhere. SSR renders `Ctrl K`, then updates. */
export function useShortcutLabel(): string {
  const apple = useSyncExternalStore(noopSubscribe, isApplePlatform, () => false);
  return apple ? '⌘ K' : 'Ctrl K';
}

const menuItem =
  'flex min-h-10 cursor-default items-center gap-2 rounded-control px-3 text-sm text-gray-900 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-gray-500 data-[highlighted]:bg-blue-50 data-[highlighted]:outline-2 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-sky-500';

export type HeaderProps = {
  locale: Locale;
  logoSrc: string;
  homeHref: string;
  profileHref: string | undefined;
  tenant: ShellTenant;
  user: ShellUser;
  LinkComponent: LinkComponent;
  onOpenLauncher: (trigger: HTMLElement) => void;
  onLocaleChange: (locale: Locale) => void;
  onSignOut: () => void;
};

/** White 64px header (design system §4.1). */
export function Header({
  locale,
  logoSrc,
  homeHref,
  profileHref,
  tenant,
  user,
  LinkComponent: A,
  onOpenLauncher,
  onLocaleChange,
  onSignOut,
}: HeaderProps) {
  const tr = (k: Parameters<typeof t>[1], v?: Parameters<typeof t>[2]) => t(locale, k, v);
  const shortcut = useShortcutLabel();

  return (
    <header className="flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:gap-6 lg:px-8">
      <A
        href={homeHref}
        aria-label={tr('header.home')}
        className="focus-ring flex shrink-0 items-center rounded-control"
      >
        {/* Plain <img>: packages/ui does not depend on next/image. */}
        <img src={logoSrc} alt="" width={96} height={32} className="h-8 w-auto" />
      </A>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(e) => onOpenLauncher(e.currentTarget)}
        className="focus-ring flex min-h-10 min-w-10 items-center gap-2 rounded-full border border-gray-200 bg-gray-25 px-3 text-sm text-gray-500 transition-colors duration-150 hover:border-gray-500 md:w-full md:max-w-md md:flex-1"
      >
        <Search
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-gray-700"
        />
        <span className="sr-only md:not-sr-only md:flex-1 md:truncate md:text-left">
          {tr('header.search')}
        </span>
        <span className="sr-only">{tr('header.searchShortcut', { keys: shortcut })}</span>
        <span aria-hidden="true" className="hidden md:inline-flex">
          <Keycap>{shortcut}</Keycap>
        </span>
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-3 lg:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {tenant.logoSrc ? (
            <img
              src={tenant.logoSrc}
              alt={tr('header.tenantLogo', { name: tenant.name })}
              className="h-8 w-auto"
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-gray-200 bg-gray-25 font-mono text-xs font-medium text-navy-900"
            >
              {initials(tenant.name).slice(0, 3)}
            </span>
          )}
          <div className="hidden min-w-0 lg:block">
            <p className="text-xs font-semibold tracking-[0.08em] text-gray-500 uppercase">
              {tr('header.tenantEyebrow')}
            </p>
            <p className="truncate text-sm font-semibold text-navy-900">{tenant.name}</p>
          </div>
          <span className="sr-only lg:hidden">{tenant.name}</span>
        </div>

        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger
            aria-label={tr('header.userMenu', { name: user.name })}
            className="focus-ring flex min-h-10 items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-gray-100"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white"
            >
              {initials(user.name)}
            </span>
            <span className="hidden text-left leading-tight md:block">
              <span className="block text-sm font-semibold text-gray-900">{user.name}</span>
              <span className="block text-xs text-gray-500">{user.roleLabel}</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              size={16}
              strokeWidth={1.75}
              className="text-gray-700"
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 min-w-64 rounded-card border border-gray-200 bg-white p-1 shadow-modal motion-safe:animate-fade-in"
            >
              <div className="px-3 py-2">
                <p className="text-xs text-gray-500">{tr('userMenu.signedInAs')}</p>
                <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                <p className="truncate text-xs text-gray-500">{user.email}</p>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />
              {profileHref && (
                <DropdownMenu.Item asChild className={menuItem}>
                  <A href={profileHref}>
                    <UserRound aria-hidden="true" size={16} strokeWidth={1.75} />
                    {tr('userMenu.profile')}
                  </A>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Group>
                <DropdownMenu.Label className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs font-semibold text-gray-500">
                  <Languages aria-hidden="true" size={16} strokeWidth={1.75} />
                  {tr('userMenu.language')}
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={locale}
                  onValueChange={(v) => onLocaleChange(v as Locale)}
                >
                  {LOCALES.map((l) => (
                    <DropdownMenu.RadioItem
                      key={l}
                      value={l}
                      lang={l}
                      className={cn(menuItem, 'pl-9 relative')}
                    >
                      <DropdownMenu.ItemIndicator className="absolute left-3">
                        <Check aria-hidden="true" size={16} strokeWidth={1.75} />
                      </DropdownMenu.ItemIndicator>
                      {tr(l === 'en' ? 'language.en' : 'language.es')}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Group>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />
              <DropdownMenu.Item disabled className={menuItem}>
                <Building aria-hidden="true" size={16} strokeWidth={1.75} />
                <span>
                  {tr('userMenu.switchCenter')}
                  <span className="block text-xs">{tr('userMenu.switchCenterNone')}</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />
              <DropdownMenu.Item className={menuItem} onSelect={() => onSignOut()}>
                <LogOut aria-hidden="true" size={16} strokeWidth={1.75} />
                {tr('userMenu.signOut')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
