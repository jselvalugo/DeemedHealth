'use client';

/**
 * Record list and record pages (ADR-0014 section 3) on the packages/ui components. The
 * records client is the real API, or, in non-production previews without a database,
 * the synthetic demo adapter (the server decides which: `authMode()`).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, type ReactNode } from 'react';
import { getRecordType } from '@deemed/domain';
import { t, type Locale } from '@deemed/i18n';
import {
  PageHeader,
  RecordPage,
  RecordTable,
  RecordsProvider,
  cn,
  type LinkComponent,
  type ListActions,
} from '@deemed/ui';
import type { AuthMode } from '../../lib/auth-mode';
import { demoRecordsClient } from '../../lib/records-demo/client';
import { httpRecordsClient } from '../../lib/records-http';
import { useApi } from './reauth';

/**
 * The health center's time zone. /api/me does not carry it yet, so it defaults to
 * Eastern (every XYZ fixture org and most Florida centers); follow-up in the S4b notes.
 */
export const DEFAULT_TIME_ZONE = 'America/New_York' as const;

export function RecordsBridge({
  mode,
  locale,
  children,
}: {
  mode: AuthMode;
  locale: Locale;
  children: ReactNode;
}) {
  const api = useApi();
  const router = useRouter();
  const client = useMemo(
    () => (mode === 'stub' ? demoRecordsClient(api) : httpRecordsClient(api)),
    [mode, api],
  );
  const navigate = useCallback((route: string) => router.push(route), [router]);
  return (
    <RecordsProvider
      client={client}
      locale={locale}
      timeZone={DEFAULT_TIME_ZONE}
      Link={Link as LinkComponent}
      navigate={navigate}
    >
      {children}
    </RecordsProvider>
  );
}

export type SiblingList = { label: string; href: string; current: boolean };

export function RecordListScreen({
  typeId,
  actions,
  initialCreate,
  eyebrow,
  title,
  description,
  siblings,
  locale,
}: {
  typeId: string;
  actions: ListActions;
  initialCreate: boolean;
  eyebrow: string;
  title: string;
  description: string;
  siblings: SiblingList[];
  locale: Locale;
}) {
  const def = getRecordType(typeId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      {siblings.length > 1 && (
        <nav aria-label={t(locale, 'records.tabs.label')} className="border-b border-gray-200">
          <ul className="flex flex-wrap gap-1">
            {siblings.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={s.current ? 'page' : undefined}
                  className={cn(
                    'focus-ring -mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-semibold',
                    s.current
                      ? 'border-teal-400 text-navy-900'
                      : 'border-transparent text-gray-700 hover:text-navy-900',
                  )}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <RecordTable def={def} actions={actions} initialCreate={initialCreate} />
    </div>
  );
}

export function RecordScreen({
  typeId,
  id,
  moduleName,
  listHref,
}: {
  typeId: string;
  id: string;
  moduleName: string;
  listHref: string;
}) {
  return (
    <RecordPage def={getRecordType(typeId)} id={id} moduleName={moduleName} listHref={listHref} />
  );
}
