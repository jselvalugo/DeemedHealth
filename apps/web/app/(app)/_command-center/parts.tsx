'use client';

/** Building blocks shared by the four Command Center pages. */
import type { ReactNode } from 'react';
import { getRecordType, type RequirementInstanceStatus } from '@deemed/domain';
import { t, tCount, type Locale } from '@deemed/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  RefText,
  buttonClasses,
  enumLabel,
  formatDate,
  formatInstant,
  recordHref,
  statusTone,
  textLinkClasses,
  useRecords,
} from '@deemed/ui';
import type { Instance, PriorityItem } from '../../../lib/command-center/summary';
import { DEFAULT_TIME_ZONE } from '../records-view';
import type { ReadinessData, ReadinessState } from './data';

const INSTANCE = getRecordType('requirement_instance');

export type CommandCenterProps = {
  locale: Locale;
  eyebrow: string;
  title: string;
  /** The Overview greets the user with the serif display heading. */
  display?: boolean;
  /** The viewer's roles include HRSA Readiness (the Command Center's only source today). */
  canReadReadiness: boolean;
  /** The Requirements list, when the viewer may open it (empty-state action). */
  requirementsHref: string | null;
  /** Fixed "today" for tests; otherwise today in the health center's time zone. */
  today?: string;
};

export function statusLabel(locale: Locale, status: RequirementInstanceStatus): string {
  return enumLabel(locale, INSTANCE, 'status', status);
}

export function StatusBadge({
  locale,
  status,
}: {
  locale: Locale;
  status: RequirementInstanceStatus;
}) {
  return <Badge status={statusTone(status)}>{statusLabel(locale, status)}</Badge>;
}

/** "3 days overdue", "Due today", "Due in 5 days", "No due date". */
export function dueText(locale: Locale, daysUntilDue: number | null): string {
  if (daysUntilDue === null) return t(locale, 'cc.due.none');
  if (daysUntilDue < 0) return tCount(locale, 'cc.due.overdue', -daysUntilDue);
  if (daysUntilDue === 0) return t(locale, 'cc.due.today');
  return tCount(locale, 'cc.due.in', daysUntilDue);
}

/** The site an instance belongs to, or "Health center-wide". */
export function SiteName({ locale, siteId }: { locale: Locale; siteId: string | null }) {
  if (!siteId) return <>{t(locale, 'records.value.orgWide')}</>;
  return <RefText type="site" id={siteId} />;
}

function Subject({ locale, instance }: { locale: Locale; instance: Instance }) {
  const kind = enumLabel(locale, INSTANCE, 'subjectType', instance.subjectType);
  const ref =
    instance.subjectId && (instance.subjectType === 'person' || instance.subjectType === 'site')
      ? instance.subjectType
      : null;
  return (
    <>
      {kind}
      {ref && instance.subjectId && (
        <>
          {': '}
          <RefText type={ref} id={instance.subjectId} />
        </>
      )}
    </>
  );
}

/** One requirement instance in a list: id (linked), subject, site, owner, due, status. */
export function InstanceRow({ locale, item }: { locale: Locale; item: PriorityItem }) {
  const { Link } = useRecords();
  const i = item.instance;
  const href = recordHref('requirement_instance', i.id);
  const overdue = item.daysUntilDue !== null && item.daysUntilDue < 0;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {href ? (
          <Link
            href={href}
            className={`${textLinkClasses} min-h-0 font-mono text-sm`}
            aria-label={t(locale, 'cc.item.open', { id: i.requirementId })}
          >
            {i.requirementId}
          </Link>
        ) : (
          <span className="font-mono text-sm font-semibold text-navy-900">{i.requirementId}</span>
        )}
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-sm text-gray-700">
          <dt className="text-gray-500">{t(locale, 'cc.item.appliesTo')}</dt>
          <dd>
            <Subject locale={locale} instance={i} />
          </dd>
          <dt className="text-gray-500">{t(locale, 'cc.sites.site')}</dt>
          <dd>
            <SiteName locale={locale} siteId={i.siteId} />
          </dd>
          <dt className="text-gray-500">{t(locale, 'cc.item.owner')}</dt>
          <dd>
            {i.ownerPersonId ? (
              <RefText type="person" id={i.ownerPersonId} />
            ) : (
              t(locale, 'cc.item.noOwner')
            )}
          </dd>
        </dl>
      </div>
      <div className="flex shrink-0 flex-row items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <StatusBadge locale={locale} status={i.status} />
        <span
          className={
            overdue ? 'text-sm font-semibold text-status-critical-text' : 'text-sm text-gray-700'
          }
        >
          {dueText(locale, item.daysUntilDue)}
          {i.nextDueOn && (
            <span className="text-gray-500"> · {formatDate(locale, i.nextDueOn)}</span>
          )}
        </span>
      </div>
    </li>
  );
}

export function InstanceList({
  locale,
  items,
  empty,
}: {
  locale: Locale;
  items: readonly PriorityItem[];
  empty: string;
}) {
  if (items.length === 0) return <p className="py-3 text-gray-700">{empty}</p>;
  return (
    <ul className="divide-y divide-gray-200">
      {items.map((item) => (
        <InstanceRow key={item.instance.id} locale={locale} item={item} />
      ))}
    </ul>
  );
}

export function LastChecked({ locale, at }: { locale: Locale; at: string | null }) {
  return (
    <p className="text-sm text-gray-500">
      {at
        ? t(locale, 'cc.lastChecked', { time: formatInstant(locale, at, DEFAULT_TIME_ZONE) })
        : t(locale, 'cc.lastChecked.never')}
    </p>
  );
}

/**
 * Header, "internal readiness" notice, and the loading, error, empty, and no-permission
 * states every Command Center page shares. `children` renders once data is ready.
 */
export function CommandCenterFrame({
  props,
  state,
  reload,
  actions,
  description,
  children,
}: {
  props: CommandCenterProps;
  state: ReadinessState;
  reload: () => void;
  actions?: ReactNode;
  description: string;
  children: (data: ReadinessData) => ReactNode;
}) {
  const { locale } = props;
  const { Link } = useRecords();
  const header = (
    <PageHeader
      eyebrow={props.eyebrow}
      title={props.title}
      display={props.display ?? false}
      description={description}
      actions={actions}
    />
  );

  let body: ReactNode;
  if (!props.canReadReadiness || (state.kind === 'error' && state.code === 'forbidden')) {
    body = (
      <EmptyState
        icon="lock"
        title={t(locale, 'cc.noReadiness.title')}
        body={t(locale, 'cc.noReadiness.body')}
      />
    );
  } else if (state.kind === 'loading') {
    body = (
      <Card aria-busy="true">
        <p role="status" className="text-gray-700">
          {t(locale, 'cc.loading')}
        </p>
      </Card>
    );
  } else if (state.kind === 'error') {
    body = (
      <Alert tone="critical" title={t(locale, 'cc.error.title')}>
        <p>{t(locale, 'cc.error.body')}</p>
        <div className="mt-3">
          <Button variant="secondary" onClick={reload}>
            {t(locale, 'cc.retry')}
          </Button>
        </div>
      </Alert>
    );
  } else if (state.items.length === 0) {
    body = (
      <EmptyState
        title={t(locale, 'cc.empty.title')}
        body={t(locale, 'cc.empty.body')}
        action={
          props.requirementsHref ? (
            <Link href={props.requirementsHref} className={buttonClasses()}>
              {t(locale, 'cc.empty.action')}
            </Link>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <>
        {state.truncated && (
          <Alert tone="warn" title={t(locale, 'cc.truncated', { count: state.items.length })} />
        )}
        {children(state)}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {props.canReadReadiness && (
        <p className="text-sm text-gray-700">
          <Badge status="info">{t(locale, 'cc.score.title')}</Badge> {t(locale, 'cc.disclaimer')}
        </p>
      )}
      {body}
    </div>
  );
}

/** A titled card section with an optional link in the header row. */
export function Section({
  id,
  title,
  link,
  children,
  className,
}: {
  id: string;
  title: string;
  link?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <section aria-labelledby={id} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={id} className="text-xl font-semibold text-navy-900">
            {title}
          </h2>
          {link && <div className="text-sm">{link}</div>}
        </div>
        {children}
      </section>
    </Card>
  );
}
