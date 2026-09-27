'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { t, type Locale } from '@deemed/i18n';
import { cn } from '../cn.js';
import { Icon } from '../icons.js';
import { LogoMark } from '../components/misc.js';
import type { ModuleEntry } from '../module-registry.js';
import type { LinkComponent } from './types.js';

const tabBase =
  'focus-ring-inset relative flex h-full items-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out';
const tabIdle = 'text-white/80 hover:bg-navy-700 hover:text-white';
const tabActive = 'bg-navy-700 text-white';

function Underline() {
  return <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-teal-400" />;
}

/**
 * How many tabs fit before the rest move into "More". Measures a hidden copy of
 * every tab so the bar never scrolls horizontally (design system §4.2).
 */
function useVisibleCount(count: number) {
  const listRef = useRef<HTMLUListElement>(null);
  const measureRef = useRef<HTMLUListElement>(null);
  const [visible, setVisible] = useState(count);

  useLayoutEffect(() => {
    const list = listRef.current;
    const measure = measureRef.current;
    if (!list || !measure) return;
    const compute = () => {
      const available = list.clientWidth;
      // The last measured item is the "More" trigger.
      const all = Array.from(measure.children).map((c) => (c as HTMLElement).offsetWidth);
      const moreWidth = all.pop() ?? 0;
      const widths = all;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= available) {
        setVisible(count);
        return;
      }
      let used = moreWidth;
      let n = 0;
      for (const w of widths) {
        if (used + w > available) break;
        used += w;
        n++;
      }
      setVisible(Math.max(0, n));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(list);
    return () => ro.disconnect();
  }, [count]);

  return { listRef, measureRef, visible };
}

export type ModuleBarProps = {
  locale: Locale;
  /** The current module with only the pages this user may open. */
  module: ModuleEntry | undefined;
  activeRoute: string | undefined;
  LinkComponent: LinkComponent;
  onOpenLauncher: (trigger: HTMLElement) => void;
};

/** Navy module bar (design system §4.2): switcher, divider, current module's page tabs. */
export function ModuleBar({
  locale,
  module,
  activeRoute,
  LinkComponent: A,
  onOpenLauncher,
}: ModuleBarProps) {
  const pages = module?.pages ?? [];
  const { listRef, measureRef, visible } = useVisibleCount(pages.length);
  const shown = pages.slice(0, visible);
  const overflow = pages.slice(visible);
  const moduleName = module ? t(locale, module.name) : '';
  const activeInOverflow = overflow.some((p) => p.route === activeRoute);

  return (
    <nav
      aria-label={t(locale, 'moduleBar.label')}
      className="relative flex h-14 items-stretch bg-navy-900 px-2 lg:px-6"
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={
          module
            ? t(locale, 'moduleBar.switcher', { module: moduleName })
            : t(locale, 'moduleBar.switcherNone')
        }
        onClick={(e) => onOpenLauncher(e.currentTarget)}
        className="focus-ring-inset flex shrink-0 items-center gap-1 rounded-control px-2 text-white hover:bg-navy-700"
      >
        <LogoMark className="size-7" />
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <span aria-hidden="true" className="mx-2 my-3 w-px shrink-0 bg-bar-divider" />

      {module && (
        <ul
          ref={listRef}
          aria-label={t(locale, 'moduleBar.pages', { module: moduleName })}
          className="flex min-w-0 flex-1 items-stretch overflow-hidden"
        >
          {shown.map((p) => {
            const active = p.route === activeRoute;
            return (
              <li key={p.id} className="flex">
                <A
                  href={p.route}
                  aria-current={active ? 'page' : undefined}
                  className={cn(tabBase, active ? tabActive : tabIdle)}
                >
                  <Icon name={p.icon} size={20} />
                  {t(locale, p.name)}
                  {active && <Underline />}
                </A>
              </li>
            );
          })}
          {overflow.length > 0 && (
            <li className="flex">
              <MoreMenu
                locale={locale}
                moduleName={moduleName}
                pages={overflow}
                activeRoute={activeRoute}
                active={activeInOverflow}
                LinkComponent={A}
              />
            </li>
          )}
        </ul>
      )}

      {/* Hidden copy used only for measuring tab widths. */}
      <ul
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 overflow-hidden"
      >
        {pages.map((p) => (
          <li key={p.id} className={cn(tabBase, 'h-auto')}>
            <Icon name={p.icon} size={20} />
            {t(locale, p.name)}
          </li>
        ))}
        <li className={cn(tabBase, 'h-auto')}>
          {t(locale, 'moduleBar.more')}
          <ChevronDown size={16} strokeWidth={1.75} />
        </li>
      </ul>
    </nav>
  );
}

function MoreMenu({
  locale,
  moduleName,
  pages,
  activeRoute,
  active,
  LinkComponent: A,
}: {
  locale: Locale;
  moduleName: string;
  pages: ModuleEntry['pages'];
  activeRoute: string | undefined;
  active: boolean;
  LinkComponent: LinkComponent;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={t(locale, 'moduleBar.moreLabel', { module: moduleName })}
        className={cn(tabBase, active ? tabActive : tabIdle)}
      >
        {t(locale, 'moduleBar.more')}
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
        {active && <Underline />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-56 rounded-card border border-gray-200 bg-white p-1 shadow-modal motion-safe:animate-fade-in"
        >
          {pages.map((p) => (
            <DropdownMenu.Item key={p.id} asChild>
              <A
                href={p.route}
                aria-current={p.route === activeRoute ? 'page' : undefined}
                className="flex min-h-10 items-center gap-2 rounded-control px-3 text-sm text-gray-900 outline-none aria-[current=page]:font-semibold data-[highlighted]:bg-blue-50 data-[highlighted]:outline-2 data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-sky-500"
              >
                <Icon name={p.icon} size={16} />
                {t(locale, p.name)}
              </A>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
