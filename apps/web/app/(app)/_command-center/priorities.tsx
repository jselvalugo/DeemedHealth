'use client';

/**
 * Command Center › Today's priorities (`/priorities`): every requirement instance that is
 * not met, grouped in working order (overdue, due this week, missing evidence, coming up).
 */
import type { CalendarDate } from '@deemed/dates';
import { t, tCount } from '@deemed/i18n';
import { EmptyState, buttonClasses, useRecords } from '@deemed/ui';
import { PRIORITY_GROUPS, priorities } from '../../../lib/command-center/summary';
import { useReadiness } from './data';
import { type CommandCenterProps, CommandCenterFrame, InstanceList, Section } from './parts';

export function CommandCenterPriorities(props: CommandCenterProps) {
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
      description={t(locale, 'cc.priorities.description')}
    >
      {({ items, today }) => {
        const groups = priorities(items, today);
        const open = PRIORITY_GROUPS.filter((g) => groups[g].length > 0);
        if (open.length === 0) {
          return (
            <EmptyState
              title={t(locale, 'cc.priorities.clear.title')}
              body={t(locale, 'cc.priorities.clear.body')}
              action={
                <Link href="/calendar" className={buttonClasses({ variant: 'secondary' })}>
                  {t(locale, 'cc.priorities.clear.action')}
                </Link>
              }
            />
          );
        }
        return (
          <>
            {open.map((g) => (
              <Section
                key={g}
                id={`cc-group-${g}`}
                title={t(locale, `cc.group.${g}`)}
                link={
                  <span className="text-gray-700">
                    {tCount(locale, 'cc.group.count', groups[g].length)}
                  </span>
                }
              >
                <p className="-mt-2 text-sm text-gray-500">{t(locale, `cc.group.${g}.hint`)}</p>
                <InstanceList locale={locale} items={groups[g]} empty="" />
              </Section>
            ))}
          </>
        );
      }}
    </CommandCenterFrame>
  );
}
