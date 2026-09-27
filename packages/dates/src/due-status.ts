import { type CalendarDate, addDays, differenceInDays } from './calendar-date.js';
import { assertInteger } from './errors.js';
import type { Instant } from './instant.js';
import { type TimeZone, startOfDayInZone, toZonedDate } from './time-zone.js';

/**
 * Where a dated obligation stands on a given day.
 * - `not_due`: more than `atRiskDays` away.
 * - `at_risk`: within `atRiskDays` days (and not today).
 * - `due_today`: the due date is today; still on time until local midnight.
 * - `overdue`: the due date has passed.
 *
 * Mapping this to readiness statuses (Met / At risk / Not met) belongs to the
 * readiness engine and the catalog, not to this package.
 */
export type DueStatus = 'not_due' | 'at_risk' | 'due_today' | 'overdue';

export interface DueOptions {
  /** Days before the due date at which the item turns `at_risk` (0 = never). */
  readonly atRiskDays: number;
}

export interface DueEvaluation {
  readonly status: DueStatus;
  /** The calendar date the evaluation used ("today" at the site). */
  readonly asOfDate: CalendarDate;
  /** Due date − as-of date in days; negative when overdue. */
  readonly daysUntilDue: number;
}

/** Evaluates on a calendar date (for "as of" reports that name a date). */
export function evaluateDueOnDate(
  dueDate: CalendarDate,
  asOfDate: CalendarDate,
  options: DueOptions,
): DueEvaluation {
  assertInteger(options.atRiskDays, 'atRiskDays', 0, 3660);
  const daysUntilDue = differenceInDays(dueDate, asOfDate);
  let status: DueStatus;
  if (daysUntilDue < 0) status = 'overdue';
  else if (daysUntilDue === 0) status = 'due_today';
  else if (daysUntilDue <= options.atRiskDays) status = 'at_risk';
  else status = 'not_due';
  return { status, asOfDate, daysUntilDue };
}

/**
 * Evaluates at an instant for a site in `timeZone`: "today" is the site's local
 * date, so the same instant can be the due date at a Central site and already
 * the next day at an Eastern one.
 */
export function evaluateDueAt(
  dueDate: CalendarDate,
  asOf: Instant,
  timeZone: TimeZone,
  options: DueOptions,
): DueEvaluation {
  return evaluateDueOnDate(dueDate, toZonedDate(asOf, timeZone), options);
}

/**
 * The first instant at which something due (or expiring) on `date` is late:
 * local midnight starting the next day. A license expiring 2027-06-30 at an
 * Eastern site is valid through 23:59:59.999 ET and expired from
 * 2027-07-01T04:00:00Z.
 */
export function lapsesAt(date: CalendarDate, timeZone: TimeZone): Instant {
  return startOfDayInZone(addDays(date, 1), timeZone);
}

/** True once `asOf` has reached {@link lapsesAt} for the expiration date. */
export function isExpiredAt(
  expirationDate: CalendarDate,
  asOf: Instant,
  timeZone: TimeZone,
): boolean {
  return asOf >= lapsesAt(expirationDate, timeZone);
}
