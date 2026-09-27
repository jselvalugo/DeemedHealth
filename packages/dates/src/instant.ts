import {
  type CalendarDate,
  fromEpochDay,
  isCalendarDate,
  mod,
  toEpochDay,
} from './calendar-date.js';
import { DatesError } from './errors.js';

declare const instantBrand: unique symbol;

/**
 * An exact point in time as UTC epoch milliseconds (Postgres `timestamptz`).
 * Branded so a plain number cannot be passed by accident. Instants compare
 * with `<`, `===`, and friends.
 */
export type Instant = number & { readonly [instantBrand]: 'Instant' };

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

// The ECMAScript time value range.
const MAX_EPOCH_MS = 8.64e15;

// Explicit Z or ±hh:mm is required: an ISO string without an offset is a
// local wall-clock time, and which zone it belongs to must never be guessed.
const ISO_INSTANT =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function invalid(): DatesError {
  return new DatesError(
    'DATES_INVALID_INSTANT',
    'Expected an ISO 8601 instant with Z or an explicit offset.',
  );
}

export function instantFromEpochMilliseconds(epochMilliseconds: number): Instant {
  if (!Number.isInteger(epochMilliseconds) || Math.abs(epochMilliseconds) > MAX_EPOCH_MS) {
    throw invalid();
  }
  return epochMilliseconds as Instant;
}

/** For values that arrive as `Date` (e.g. from a database driver). */
export function instantFromDate(date: Date): Instant {
  return instantFromEpochMilliseconds(date.getTime());
}

/** For APIs that need a `Date`. The `Date` is only a carrier of the instant. */
export function instantToDate(instant: Instant): Date {
  return new Date(instant);
}

/**
 * Parses `YYYY-MM-DDTHH:mm[:ss[.sss]](Z|±hh:mm)`. Rejects missing offsets,
 * impossible dates (2027-02-29), and out-of-range fields.
 */
export function parseInstant(value: string): Instant {
  const m = ISO_INSTANT.exec(value);
  if (m === null || !isCalendarDate(m[1])) throw invalid();
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  const second = Number(m[4] ?? '0');
  const millisecond = Number((m[5] ?? '0').padEnd(3, '0'));
  const sign = m[6] === '-' ? -1 : 1;
  const offsetHours = Number(m[7] ?? '0');
  const offsetMinutes = Number(m[8] ?? '0');
  if (hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) {
    throw invalid();
  }
  const local =
    toEpochDay(m[1]) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    millisecond;
  return instantFromEpochMilliseconds(
    local - sign * (offsetHours * MS_PER_HOUR + offsetMinutes * MS_PER_MINUTE),
  );
}

/** The UTC calendar date of an instant. Use `toZonedDate` for a site's local date. */
export function utcDateOf(instant: Instant): CalendarDate {
  return fromEpochDay(Math.floor(instant / MS_PER_DAY));
}

/** Formats as `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export function formatInstant(instant: Instant): string {
  const msOfDay = mod(instant, MS_PER_DAY);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  const hh = pad(Math.floor(msOfDay / MS_PER_HOUR));
  const mm = pad(Math.floor(msOfDay / MS_PER_MINUTE) % 60);
  const ss = pad(Math.floor(msOfDay / MS_PER_SECOND) % 60);
  const sss = pad(msOfDay % MS_PER_SECOND, 3);
  return `${utcDateOf(instant)}T${hh}:${mm}:${ss}.${sss}Z`;
}

export function addMilliseconds(instant: Instant, milliseconds: number): Instant {
  return instantFromEpochMilliseconds(instant + milliseconds);
}
