'use client';

/**
 * Command Center › Calendar (`/calendar`): requirement due dates by month, in the health
 * center's time zone. The month grid is for wide screens; the list under it carries the
 * same items for every screen size and for screen readers.
 */
import { useState } from 'react';
import { type CalendarDate, addMonths, startOfMonth, toParts } from '@deemed/dates';
import { t, tCount, type Locale } from '@deemed/i18n';
import { Button, LOCALE_TAGS, cn, recordHref, statusTone, useRecords } from '@deemed/ui';
import { type CalendarDay, monthGrid, monthItems } from '../../../lib/command-center/summary';
import { useReadiness } from './data';
import {
  type CommandCenterProps,
  CommandCenterFrame,
  InstanceList,
  Section,
  statusLabel,
} from './parts';

/** Items shown in a grid cell before "+N more". */
const PER_DAY = 3;

const CHIP: Record<ReturnType<typeof statusTone>, string> = {
  ok: 'border-status-ok-icon bg-status-ok-bg text-status-ok-text',
  warn: 'border-status-warn-icon bg-status-warn-bg text-status-warn-text',
  critical: 'border-status-critical-icon bg-status-critical-bg text-status-critical-text',
  info: 'border-status-info-icon bg-status-info-bg text-status-info-text',
  neutral: 'border-status-neutral-icon bg-status-neutral-bg text-status-neutral-text',
};

function monthName(locale: Locale, month: CalendarDate): string {
  const { year, month: m } = toParts(month);
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, m - 1, 1));
}

/** Sunday-first weekday names (2026-01-04 was a Sunday). */
function weekdays(locale: Locale): { short: string; long: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const at = Date.UTC(2026, 0, 4 + i);
    const fmt = (weekday: 'short' | 'long') =>
      new Intl.DateTimeFormat(LOCALE_TAGS[locale], { weekday, timeZone: 'UTC' }).format(at);
    return { short: fmt('short'), long: fmt('long') };
  });
}

function DayCell({ locale, day }: { locale: Locale; day: CalendarDay }) {
  const { Link } = useRecords();
  const shown = day.items.slice(0, PER_DAY);
  const more = day.items.length - shown.length;
  return (
    <td
      className={cn(
        'h-28 w-[14.28%] border border-gray-200 p-1.5 align-top',
        day.inMonth ? 'bg-white' : 'bg-gray-25',
      )}
      aria-current={day.isToday ? 'date' : undefined}
    >
      <div className="flex items-center justify-between">
        <time
          dateTime={day.date}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-full text-sm',
            day.isToday
              ? 'bg-navy-900 font-semibold text-white'
              : day.inMonth
                ? 'text-gray-900'
                : 'text-gray-500',
          )}
        >
          {toParts(day.date).day}
        </time>
        {day.isToday && (
          <span className="text-xs font-semibold text-navy-900">
            {t(locale, 'cc.calendar.today')}
          </span>
        )}
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {shown.map((i) => {
          const href = recordHref('requirement_instance', i.id);
          const label = `${i.requirementId}, ${statusLabel(locale, i.status)}`;
          const cls = cn(
            'block truncate rounded-sm border-l-4 px-1.5 py-0.5 font-mono text-xs',
            CHIP[statusTone(i.status)],
          );
          return (
            <li key={i.id}>
              {href ? (
                <Link href={href} className={cn('focus-ring hover:underline', cls)}>
                  <span aria-hidden="true">{i.requirementId}</span>
                  <span className="sr-only">{label}</span>
                </Link>
              ) : (
                <span className={cls} title={label}>
                  {i.requirementId}
                </span>
              )}
            </li>
          );
        })}
        {more > 0 && (
          <li className="px-1.5 text-xs text-gray-700">
            {tCount(locale, 'cc.calendar.more', more)}
          </li>
        )}
      </ul>
    </td>
  );
}

function MonthView({
  locale,
  today,
  items,
}: {
  locale: Locale;
  today: CalendarDate;
  items: Parameters<typeof monthGrid>[2];
}) {
  const [offset, setOffset] = useState(0);
  const month = addMonths(startOfMonth(today), offset);
  const name = monthName(locale, month);
  const weeks = monthGrid(month, today, items);
  const list = monthItems(month, today, items);
  const days = weekdays(locale);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-navy-900" aria-live="polite">
          {name}
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOffset((o) => o - 1)}>
            {t(locale, 'cc.calendar.prev')}
          </Button>
          <Button variant="secondary" onClick={() => setOffset(0)} disabled={offset === 0}>
            {t(locale, 'cc.calendar.thisMonth')}
          </Button>
          <Button variant="secondary" onClick={() => setOffset((o) => o + 1)}>
            {t(locale, 'cc.calendar.next')}
          </Button>
        </div>
      </div>
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">
            {`${name}: ${tCount(locale, 'cc.calendar.dueCount', list.length)}`}
          </caption>
          <thead>
            <tr>
              {days.map((d) => (
                <th
                  key={d.long}
                  scope="col"
                  abbr={d.long}
                  className="py-2 text-left text-sm font-semibold text-gray-500"
                >
                  {d.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]?.date}>
                {week.map((day) => (
                  <DayCell key={day.date} locale={locale} day={day} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Section id="cc-month-list" title={t(locale, 'cc.calendar.list', { month: name })}>
        <InstanceList locale={locale} items={list} empty={t(locale, 'cc.calendar.listNone')} />
      </Section>
    </>
  );
}

export function CommandCenterCalendar(props: CommandCenterProps) {
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
      description={t(locale, 'cc.calendar.description')}
    >
      {({ items, today }) => <MonthView locale={locale} today={today} items={items} />}
    </CommandCenterFrame>
  );
}
