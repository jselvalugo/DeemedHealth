import {
  type CalendarDate,
  addDays,
  addMonths,
  compareDates,
  differenceInDays,
  toParts,
} from './calendar-date.js';
import { assertInteger } from './errors.js';

export type CadenceUnit = 'day' | 'week' | 'month' | 'year';

/** "Every `every` `unit`s", e.g. `{ every: 24, unit: 'month' }` for a 24-month cycle. */
export interface Cadence {
  readonly every: number;
  readonly unit: CadenceUnit;
}

const MAX_EVERY = 1200;

export function cadence(every: number, unit: CadenceUnit): Cadence {
  assertInteger(every, 'every', 1, MAX_EVERY);
  return { every, unit };
}

function stepDays(c: Cadence): number {
  return c.unit === 'week' ? c.every * 7 : c.every;
}

function stepMonths(c: Cadence): number {
  return c.unit === 'year' ? c.every * 12 : c.every;
}

function isDayBased(c: Cadence): boolean {
  return c.unit === 'day' || c.unit === 'week';
}

/**
 * The `n`th occurrence of an anchored series: `anchor + n × cadence`, always
 * computed from the anchor so month-end dates do not drift. A monthly series
 * anchored on Jan 31 gives Feb 28 (29), Mar 31, Apr 30, never "the 28th forever".
 */
export function nthOccurrence(anchor: CalendarDate, c: Cadence, n: number): CalendarDate {
  assertInteger(c.every, 'every', 1, MAX_EVERY);
  assertInteger(n, 'n', 0, 100_000);
  return isDayBased(c) ? addDays(anchor, stepDays(c) * n) : addMonths(anchor, stepMonths(c) * n);
}

/** Occurrences 1..count after the anchor (the anchor itself is not included). */
export function occurrences(anchor: CalendarDate, c: Cadence, count: number): CalendarDate[] {
  assertInteger(count, 'count', 0, 10_000);
  return Array.from({ length: count }, (_, i) => nthOccurrence(anchor, c, i + 1));
}

/** The first occurrence after the anchor (n >= 1) that falls on or after `date`. */
export function nextOccurrenceOnOrAfter(
  anchor: CalendarDate,
  c: Cadence,
  date: CalendarDate,
): CalendarDate {
  assertInteger(c.every, 'every', 1, MAX_EVERY);
  let n: number;
  if (isDayBased(c)) {
    n = Math.ceil(differenceInDays(date, anchor) / stepDays(c));
  } else {
    const a = toParts(anchor);
    const d = toParts(date);
    const monthGap = d.year * 12 + d.month - (a.year * 12 + a.month);
    n = Math.floor(monthGap / stepMonths(c));
  }
  n = Math.max(n, 1);
  const candidate = nthOccurrence(anchor, c, n);
  // A month-based estimate is one step short when it lands in the target
  // month on an earlier day (or in an earlier month); the next step is not.
  return compareDates(candidate, date) < 0 ? nthOccurrence(anchor, c, n + 1) : candidate;
}

/**
 * "Every N months from last verification": the next due date re-anchors on the
 * date the item was actually verified (unlike an anchored series). Clamps at
 * month end: verified Aug 31, every 6 months, is due Feb 28 (29).
 */
export function nextDueFromLastVerification(
  lastVerified: CalendarDate,
  everyMonths: number,
): CalendarDate {
  assertInteger(everyMonths, 'everyMonths', 1, MAX_EVERY);
  return addMonths(lastVerified, everyMonths);
}
