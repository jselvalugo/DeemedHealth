'use client';

/**
 * Command Center › Overview (`/`): the internal readiness score with its denominator,
 * requirements by status, readiness by site, the top priorities, what is due in the next
 * 30 days, and the way into the readiness brief.
 */
import type { CalendarDate } from '@deemed/dates';
import { t } from '@deemed/i18n';
import { Card, LinkArrow, textLinkClasses, useRecords } from '@deemed/ui';
import {
  BRIEF_HORIZON_DAYS,
  STATUSES,
  type Readiness,
  dueWithin,
  lastChecked,
  priorities,
  readiness,
  readinessBySite,
  topPriorities,
} from '../../../lib/command-center/summary';
import { useReadiness } from './data';
import {
  type CommandCenterProps,
  CommandCenterFrame,
  InstanceList,
  LastChecked,
  Section,
  SiteName,
  StatusBadge,
} from './parts';

const TOP = 5;

function ScoreCard({ locale, score }: { locale: CommandCenterProps['locale']; score: Readiness }) {
  const percent = score.percent;
  return (
    <Card className="flex flex-col gap-3">
      <h2 id="cc-score" className="text-xl font-semibold text-navy-900">
        {t(locale, 'cc.score.title')}
      </h2>
      {percent === null ? (
        <p className="text-gray-700">{t(locale, 'cc.score.none')}</p>
      ) : (
        <>
          <p className="flex items-baseline gap-3">
            <span className="font-serif text-5xl font-semibold text-navy-900">{percent}%</span>
            <span className="text-gray-700">
              {t(locale, 'cc.score.detail', { met: score.met, applicable: score.applicable })}
            </span>
          </p>
          <div
            role="meter"
            aria-labelledby="cc-score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={t(locale, 'cc.score.label', {
              percent,
              met: score.met,
              applicable: score.applicable,
            })}
            className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
          >
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
      {score.counts.not_applicable > 0 && (
        <p className="text-sm text-gray-500">
          {t(locale, 'cc.score.notApplicable', { count: score.counts.not_applicable })}
        </p>
      )}
    </Card>
  );
}

function StatusCounts({
  locale,
  score,
  href,
}: {
  locale: CommandCenterProps['locale'];
  score: Readiness;
  href: string | null;
}) {
  const { Link } = useRecords();
  return (
    <Section
      id="cc-status"
      title={t(locale, 'cc.status.title')}
      link={
        href ? (
          <Link href={href} className={textLinkClasses}>
            {t(locale, 'cc.empty.action')}
            <LinkArrow />
          </Link>
        ) : undefined
      }
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STATUSES.map((s) => (
          <li key={s} className="flex flex-col gap-2 rounded-card border border-gray-200 p-3">
            <span className="text-3xl font-semibold text-navy-900">{score.counts[s]}</span>
            <span>
              <StatusBadge locale={locale} status={s} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SiteTable({
  locale,
  rows,
}: {
  locale: CommandCenterProps['locale'];
  rows: ReturnType<typeof readinessBySite>;
}) {
  return (
    <Section id="cc-sites" title={t(locale, 'cc.sites.title')}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th scope="col" className="py-2 pr-4 font-semibold">
                {t(locale, 'cc.sites.site')}
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold">
                {t(locale, 'cc.sites.score')}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">
                {t(locale, 'cc.sites.overdue')}
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                {t(locale, 'cc.sites.missing')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map(({ siteId, readiness: r }) => (
              <tr key={siteId ?? 'org'}>
                <th scope="row" className="py-2 pr-4 font-semibold text-navy-900">
                  <SiteName locale={locale} siteId={siteId} />
                </th>
                <td className="py-2 pr-4 text-gray-700">
                  {r.percent === null
                    ? t(locale, 'cc.sites.noScore')
                    : `${r.percent}% · ${t(locale, 'cc.sites.ratio', { met: r.met, applicable: r.applicable })}`}
                </td>
                <td className="py-2 pr-4 text-right text-gray-900">{r.counts.overdue}</td>
                <td className="py-2 text-right text-gray-900">{r.counts.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function CommandCenterOverview(props: CommandCenterProps) {
  const { locale } = props;
  const { Link } = useRecords();
  const [state, reload] = useReadiness(
    props.canReadReadiness,
    props.today as CalendarDate | undefined,
  );
  return (
    <CommandCenterFrame
      props={props}
      state={state}
      reload={reload}
      description={t(locale, 'cc.overview.description')}
    >
      {({ items, today }) => {
        const score = readiness(items);
        const top = topPriorities(priorities(items, today), TOP);
        const upcoming = dueWithin(items, today, BRIEF_HORIZON_DAYS).filter(
          (p) => p.instance.status !== 'met',
        );
        return (
          <>
            <LastChecked locale={locale} at={lastChecked(items)} />
            <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
              <ScoreCard locale={locale} score={score} />
              <StatusCounts locale={locale} score={score} href={props.requirementsHref} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Section
                id="cc-priorities"
                title={t(locale, 'cc.priorities.title')}
                link={
                  <Link href="/priorities" className={textLinkClasses}>
                    {t(locale, 'cc.priorities.viewAll')}
                    <LinkArrow />
                  </Link>
                }
              >
                <InstanceList locale={locale} items={top} empty={t(locale, 'cc.priorities.none')} />
              </Section>
              <Section
                id="cc-upcoming"
                title={t(locale, 'cc.upcoming.title')}
                link={
                  <Link href="/calendar" className={textLinkClasses}>
                    {t(locale, 'cc.upcoming.viewCalendar')}
                    <LinkArrow />
                  </Link>
                }
              >
                <InstanceList
                  locale={locale}
                  items={upcoming.slice(0, TOP)}
                  empty={t(locale, 'cc.upcoming.none')}
                />
              </Section>
            </div>
            <SiteTable locale={locale} rows={readinessBySite(items)} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Section id="cc-brief-card" title={t(locale, 'cc.briefCard.title')}>
                <p className="text-gray-700">{t(locale, 'cc.briefCard.body')}</p>
                <div>
                  <Link href="/briefs" className={textLinkClasses}>
                    {t(locale, 'cc.briefCard.open')}
                    <LinkArrow />
                  </Link>
                </div>
              </Section>
              <Section id="cc-changes" title={t(locale, 'cc.changes.title')}>
                <p className="text-gray-700">{t(locale, 'cc.changes.body')}</p>
              </Section>
            </div>
          </>
        );
      }}
    </CommandCenterFrame>
  );
}
