import { type CalendarDate, addDays, compareDates } from './calendar-date.js';
import { DatesError, assertInteger } from './errors.js';

/** One lead-day reminder: `leadDays` before the due date, on `date`. */
export interface LeadDayReminder {
  readonly leadDays: number;
  readonly date: CalendarDate;
}

const MAX_LEAD_DAYS = 3660;

/**
 * Validates a catalog lead-day list such as [90, 60, 30, 0]: non-empty,
 * non-negative integers, no duplicates. Returns it sorted largest first.
 */
export function normalizeLeadDays(leadDays: readonly number[]): number[] {
  if (leadDays.length === 0) {
    throw new DatesError('DATES_INVALID_ARGUMENT', 'Lead days must not be empty.');
  }
  for (const d of leadDays) assertInteger(d, 'leadDays', 0, MAX_LEAD_DAYS);
  const sorted = [...leadDays].sort((a, b) => b - a);
  if (new Set(sorted).size !== sorted.length) {
    throw new DatesError('DATES_INVALID_ARGUMENT', 'Lead days must not repeat.');
  }
  return sorted;
}

/** Every reminder for a due date, earliest first (largest lead first). */
export function leadDaySchedule(
  dueDate: CalendarDate,
  leadDays: readonly number[],
): LeadDayReminder[] {
  return normalizeLeadDays(leadDays).map((d) => ({ leadDays: d, date: addDays(dueDate, -d) }));
}

/**
 * Reminders whose date is on or before `asOf`, earliest first. A job that was
 * down for a few days still finds every reminder it owes; it pairs each with
 * an idempotency key (record, due date, leadDays) so none is sent twice.
 */
export function remindersDueThrough(
  dueDate: CalendarDate,
  leadDays: readonly number[],
  asOf: CalendarDate,
): LeadDayReminder[] {
  return leadDaySchedule(dueDate, leadDays).filter((r) => compareDates(r.date, asOf) <= 0);
}

/**
 * The most urgent lead tier reached as of `asOf` (e.g. 30 between 30 and 1
 * days out), or `null` before the first reminder date. After the due date the
 * smallest tier stays reached.
 */
export function currentLeadTier(
  dueDate: CalendarDate,
  leadDays: readonly number[],
  asOf: CalendarDate,
): number | null {
  const reached = remindersDueThrough(dueDate, leadDays, asOf);
  const last = reached.at(-1);
  return last === undefined ? null : last.leadDays;
}
