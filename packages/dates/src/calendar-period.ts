import {
  type CalendarDate,
  calendarDate,
  compareDates,
  daysInMonth,
  toParts,
} from './calendar-date.js';
import { assertInteger } from './errors.js';

/**
 * Calendar periods of `months` months ("at least once in each calendar month", "each
 * calendar quarter"), aligned to January of year 1, so for any `months` that divides 12
 * the periods line up with the calendar year (quarters are Jan-Mar, Apr-Jun, ...).
 * Unlike a cadence counted from the last completion, the period is fixed by the calendar.
 */
export interface CalendarPeriod {
  /** Sequential period number; consecutive periods differ by 1. */
  readonly index: number;
  readonly start: CalendarDate;
  /** Last day of the period, inclusive. */
  readonly end: CalendarDate;
}

const MAX_PERIOD_MONTHS = 120;

function monthIndex(date: CalendarDate): number {
  const { year, month } = toParts(date);
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number, day: 'first' | 'last'): CalendarDate {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return calendarDate(year, month, day === 'first' ? 1 : daysInMonth(year, month));
}

/** The period with sequential number `index`. */
export function calendarPeriodAt(index: number, months: number): CalendarPeriod {
  assertInteger(months, 'months', 1, MAX_PERIOD_MONTHS);
  // Every month of the period must fall within years 1..9999.
  assertInteger(
    index,
    'index',
    Math.ceil(12 / months),
    Math.floor((9999 * 12 + 12 - months) / months),
  );
  const first = index * months;
  return {
    index,
    start: fromMonthIndex(first, 'first'),
    end: fromMonthIndex(first + months - 1, 'last'),
  };
}

/** The calendar period that contains `date`. */
export function calendarPeriodOf(date: CalendarDate, months: number): CalendarPeriod {
  assertInteger(months, 'months', 1, MAX_PERIOD_MONTHS);
  return calendarPeriodAt(Math.floor(monthIndex(date) / months), months);
}

/** True when `date` falls inside `period` (inclusive). */
export function isInPeriod(date: CalendarDate, period: CalendarPeriod): boolean {
  return compareDates(date, period.start) >= 0 && compareDates(date, period.end) <= 0;
}
