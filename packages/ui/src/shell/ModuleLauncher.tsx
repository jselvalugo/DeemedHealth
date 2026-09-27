'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t, tCount, type Locale } from '@deemed/i18n';
import { cn } from '../cn.js';
import { Badge } from '../components/Badge.js';
import { Highlight, IconTile, Keycap } from '../components/misc.js';
import { searchModules, type Match } from '../fuzzy.js';
import { Icon } from '../icons.js';
import type { ModuleEntry, PageEntry } from '../module-registry.js';

export type LauncherItem = {
  key: string;
  kind: 'module' | 'page';
  route: string;
  module: ModuleEntry;
  page?: PageEntry;
  match: Match | null;
};

export type ModuleLauncherProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Modules the user may open, already filtered by permission (see launcherModules). */
  modules: readonly ModuleEntry[];
  currentModuleId: string | undefined;
  locale: Locale;
  onNavigate: (route: string) => void;
  /** Start with the current module selected (module switcher) instead of the first item. */
  focusCurrentModule?: boolean;
  /** Called when the dialog closes; `navigated` is true when it closed by opening a route. */
  onClosed?: (navigated: boolean) => void;
};

/**
 * Module launcher / command palette (design system §4.3). Built on Radix Dialog
 * (focus trap, Esc, aria-modal, focus return) with a combobox + listbox using
 * aria-activedescendant: focus stays in the search field while arrows/Tab move
 * the active option.
 */
export function ModuleLauncher(props: ModuleLauncherProps) {
  const { open, onOpenChange, locale } = props;
  const navigated = useRef(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) navigated.current = false;
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] motion-safe:animate-fade-in" />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            if (props.onClosed) {
              e.preventDefault();
              props.onClosed(navigated.current);
              navigated.current = false;
            }
          }}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-white outline-none',
            'sm:inset-auto sm:top-20 sm:left-1/2 sm:max-h-[calc(100dvh-7rem)] sm:w-[min(960px,calc(100vw-4rem))] sm:-translate-x-1/2',
            'sm:rounded-modal sm:shadow-modal motion-safe:animate-launcher-in',
          )}
        >
          <Dialog.Title className="sr-only">{t(locale, 'launcher.title')}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {t(locale, 'launcher.instructions')}
          </Dialog.Description>
          <LauncherBody
            {...props}
            onNavigate={(route) => {
              navigated.current = true;
              props.onNavigate(route);
              onOpenChange(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LauncherBody({
  modules,
  currentModuleId,
  locale,
  onNavigate,
  focusCurrentModule,
}: ModuleLauncherProps) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const [query, setQuery] = useState('');

  const results = useMemo(
    () => searchModules(modules, query, (k) => t(locale, k)),
    [modules, query, locale],
  );

  const { items, rows } = useMemo(() => {
    const out: LauncherItem[] = [];
    const rowIdx: { moduleIndex: number; pageIndices: number[] }[] = [];
    for (const r of results) {
      const row = { moduleIndex: out.length, pageIndices: [] as number[] };
      rowIdx.push(row);
      out.push({
        key: `m:${r.module.id}`,
        kind: 'module',
        route: r.module.pages[0]?.route ?? '/',
        module: r.module,
        match: r.match,
      });
      for (const p of r.pages) {
        row.pageIndices.push(out.length);
        out.push({
          key: `p:${r.module.id}:${p.page.id}`,
          kind: 'page',
          route: p.page.route,
          module: r.module,
          page: p.page,
          match: p.match,
        });
      }
    }
    return { items: out, rows: rowIdx };
  }, [results]);

  const [active, setActive] = useState(() => {
    if (!focusCurrentModule || !currentModuleId) return 0;
    const i = items.findIndex((it) => it.kind === 'module' && it.module.id === currentModuleId);
    return Math.max(0, i);
  });
  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = document.getElementById(optionId(activeIndex));
    el?.scrollIntoView?.({ block: 'nearest' });
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  function move(delta: number) {
    if (items.length === 0) return;
    setActive((i) => (Math.min(i, items.length - 1) + delta + items.length) % items.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Tab':
        // "Tab move" (design system §4.3): Tab walks the results; focus stays in the
        // field. Stop Radix's focus-trap handler from also moving focus.
        e.preventDefault();
        e.stopPropagation();
        move(e.shiftKey ? -1 : 1);
        break;
      case 'PageDown':
      case 'PageUp': {
        // Jump to the next / previous module row.
        e.preventDefault();
        const dir = e.key === 'PageDown' ? 1 : -1;
        for (let i = activeIndex + dir; i >= 0 && i < items.length; i += dir) {
          if (items[i]?.kind === 'module') {
            setActive(i);
            break;
          }
        }
        break;
      }
      case 'Enter': {
        const item = items[activeIndex];
        if (item) {
          e.preventDefault();
          onNavigate(item.route);
        }
        break;
      }
    }
  }

  const pageCount = results.reduce((n, r) => n + r.pages.length, 0);

  return (
    <>
      <div className="flex items-center gap-3 border-b-2 border-gray-200 px-4 focus-within:border-sky-500">
        <Search
          aria-hidden="true"
          size={20}
          strokeWidth={1.75}
          className="shrink-0 text-gray-500"
        />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={t(locale, 'launcher.title')}
          placeholder={t(locale, 'launcher.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-14 flex-1 bg-transparent text-lg text-gray-900 outline-none placeholder:text-gray-500"
        />
        <Dialog.Close
          aria-label={t(locale, 'launcher.close')}
          className="focus-ring inline-flex size-10 items-center justify-center rounded-control text-gray-700 hover:bg-gray-100"
        >
          <X aria-hidden="true" size={20} strokeWidth={1.75} />
        </Dialog.Close>
      </div>

      <div
        aria-hidden="true"
        className="hidden grid-cols-[2fr_3fr] bg-gray-25 px-4 py-2 text-xs font-semibold tracking-[0.08em] text-gray-500 uppercase sm:grid"
      >
        <span>{t(locale, 'launcher.colModule')}</span>
        <span className="pl-3">{t(locale, 'launcher.colPages')}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div id={listboxId} role="listbox" aria-label={t(locale, 'launcher.results')}>
          {results.map((r, ri) => {
            const moduleName = t(locale, r.module.name);
            const row = rows[ri];
            if (!row) return null;
            const moduleIndex = row.moduleIndex;
            const moduleActive = moduleIndex === activeIndex;
            const isCurrent = r.module.id === currentModuleId;
            return (
              <div
                key={r.module.id}
                role="group"
                aria-label={moduleName}
                className="grid gap-1 border-b border-gray-100 p-2 sm:grid-cols-[2fr_3fr]"
              >
                {/* Options are chosen with the keyboard from the search field
                    (aria-activedescendant); pointer users can click them too. */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <div
                  id={optionId(moduleIndex)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={moduleActive}
                  data-kind="module"
                  data-route={items[moduleIndex]?.route}
                  onMouseMove={() => moduleActive || setActive(moduleIndex)}
                  onClick={() => onNavigate(items[moduleIndex]?.route ?? '/')}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-card p-3',
                    moduleActive && 'bg-blue-50 outline-2 -outline-offset-2 outline-sky-500',
                  )}
                >
                  <IconTile name={r.module.icon} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy-900">
                        <Highlight text={moduleName} ranges={r.match?.ranges} />
                      </span>
                      {isCurrent && <Badge status="ok">{t(locale, 'launcher.current')}</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">
                      {t(locale, r.module.description)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col py-1 sm:pl-2">
                  {r.pages.map((p, pi) => {
                    const i = row.pageIndices[pi] ?? -1;
                    const isActive = i === activeIndex;
                    return (
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                      <div
                        key={p.page.id}
                        id={optionId(i)}
                        role="option"
                        tabIndex={-1}
                        aria-selected={isActive}
                        data-kind="page"
                        data-route={p.page.route}
                        onMouseMove={() => isActive || setActive(i)}
                        onClick={() => onNavigate(p.page.route)}
                        className={cn(
                          'flex min-h-10 cursor-pointer items-center gap-2 rounded-control px-3 text-sm text-gray-900',
                          isActive && 'bg-blue-50 outline-2 -outline-offset-2 outline-sky-500',
                        )}
                      >
                        <Icon name={p.page.icon} size={16} className="shrink-0 text-navy-900" />
                        <Highlight text={t(locale, p.page.name)} ranges={p.match?.ranges} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {results.length === 0 && (
          <div className="px-6 py-10 text-center">
            {modules.length === 0 ? (
              <p className="text-gray-700">{t(locale, 'launcher.noAccess')}</p>
            ) : (
              <>
                <p className="font-semibold text-gray-900">
                  {t(locale, 'launcher.empty', { query: query.trim() })}
                </p>
                <p className="mt-1 text-sm text-gray-500">{t(locale, 'launcher.emptyHint')}</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-25 px-4 py-2 text-xs text-gray-500 sm:rounded-b-modal">
        <p aria-live="polite" aria-atomic="true">
          {tCount(locale, 'launcher.modules', results.length)} ·{' '}
          {tCount(locale, 'launcher.pages', pageCount)}
        </p>
        <p aria-hidden="true" className="hidden items-center gap-3 sm:flex">
          <span className="inline-flex items-center gap-1">
            <Keycap>{t(locale, 'launcher.keyTab')}</Keycap> {t(locale, 'launcher.hintMove')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>{t(locale, 'launcher.keyEnter')}</Keycap> {t(locale, 'launcher.hintOpen')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Keycap>{t(locale, 'launcher.keyEsc')}</Keycap> {t(locale, 'launcher.hintClose')}
          </span>
        </p>
      </div>
    </>
  );
}
