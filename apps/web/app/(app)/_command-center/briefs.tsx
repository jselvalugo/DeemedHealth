'use client';

/**
 * Command Center › Readiness briefs (`/briefs`): a plain, computed summary of where the
 * health center stands. It is not written by AI (the Deemed Assistant's drafted briefs
 * arrive in Phase 6, behind evals and a per-tenant switch) and it attests to nothing.
 */
import type { CalendarDate } from '@deemed/dates';
import { t } from '@deemed/i18n';
import { Button, Card, formatDate } from '@deemed/ui';
import { readinessBrief } from '../../../lib/command-center/summary';
import { useReadiness } from './data';
import {
  type CommandCenterProps,
  CommandCenterFrame,
  InstanceList,
  LastChecked,
  SiteName,
} from './parts';

export function CommandCenterBriefs(props: CommandCenterProps) {
  const { locale } = props;
  const [state, reload] = useReadiness(
    props.canReadReadiness,
    props.today as CalendarDate | undefined,
  );
  return (
    <CommandCenterFrame
      props={props}
      state={state}
      reload={reload}
      description={t(locale, 'cc.briefs.description')}
      actions={
        state.kind === 'ready' && state.items.length > 0 ? (
          <Button variant="secondary" onClick={() => window.print()}>
            {t(locale, 'cc.brief.print')}
          </Button>
        ) : undefined
      }
    >
      {({ items, today }) => {
        const brief = readinessBrief(items, today);
        const r = brief.readiness;
        return (
          <Card>
            <article aria-labelledby="cc-brief" className="flex max-w-3xl flex-col gap-5">
              <header className="flex flex-col gap-1">
                <h2 id="cc-brief" className="text-2xl font-semibold text-navy-900">
                  {t(locale, 'cc.brief.title')}
                </h2>
                <p className="text-gray-700">
                  {t(locale, 'cc.brief.asOf', { date: formatDate(locale, brief.asOf) })}
                </p>
                <LastChecked locale={locale} at={brief.lastChecked} />
                <p className="text-sm text-gray-500">{t(locale, 'cc.brief.computed')}</p>
              </header>

              <section aria-labelledby="cc-brief-summary" className="flex flex-col gap-2">
                <h3 id="cc-brief-summary" className="text-lg font-semibold text-navy-900">
                  {t(locale, 'cc.brief.summary')}
                </h3>
                <p className="text-gray-900">
                  {r.percent === null
                    ? t(locale, 'cc.brief.scoreNone')
                    : t(locale, 'cc.brief.score', {
                        percent: r.percent,
                        met: r.met,
                        applicable: r.applicable,
                      })}
                </p>
                <p className="text-gray-900">
                  {t(locale, 'cc.brief.counts', {
                    overdue: r.counts.overdue,
                    missing: r.counts.missing,
                    dueSoon: r.counts.due_soon,
                    notApplicable: r.counts.not_applicable,
                  })}
                </p>
              </section>

              <section aria-labelledby="cc-brief-focus" className="flex flex-col gap-2">
                <h3 id="cc-brief-focus" className="text-lg font-semibold text-navy-900">
                  {t(locale, 'cc.brief.focus')}
                </h3>
                {brief.attention.length === 0 ? (
                  <p className="text-gray-700">{t(locale, 'cc.brief.focusNone')}</p>
                ) : (
                  <ul className="list-disc pl-5 text-gray-900">
                    {brief.attention.map((s) => (
                      <li key={s.siteId ?? 'org'}>
                        <span className="font-semibold">
                          <SiteName locale={locale} siteId={s.siteId} />
                        </span>
                        {': '}
                        {t(locale, 'cc.brief.focusRow', {
                          overdue: s.readiness.counts.overdue,
                          missing: s.readiness.counts.missing,
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="cc-brief-upcoming" className="flex flex-col gap-1">
                <h3 id="cc-brief-upcoming" className="text-lg font-semibold text-navy-900">
                  {t(locale, 'cc.brief.upcoming')}
                </h3>
                <InstanceList
                  locale={locale}
                  items={brief.dueNext30}
                  empty={t(locale, 'cc.brief.upcomingNone')}
                />
              </section>
            </article>
          </Card>
        );
      }}
    </CommandCenterFrame>
  );
}
