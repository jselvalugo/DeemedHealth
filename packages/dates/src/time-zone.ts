import { type CalendarDate, calendarDate, toEpochDay } from './calendar-date.js';
import { DatesError, assertInteger } from './errors.js';
import {
  type Instant,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  instantFromEpochMilliseconds,
} from './instant.js';

/**
 * The only zones a Deemed Health site or organization may use. Florida has two:
 * Eastern, and Central for the western Panhandle (docs/compliance/florida.md).
 */
export const SUPPORTED_TIME_ZONES = ['America/New_York', 'America/Chicago'] as const;

export type TimeZone = (typeof SUPPORTED_TIME_ZONES)[number];

export function isSupportedTimeZone(value: unknown): value is TimeZone {
  return (SUPPORTED_TIME_ZONES as readonly unknown[]).includes(value);
}

export function parseTimeZone(value: string): TimeZone {
  if (!isSupportedTimeZone(value)) {
    throw new DatesError(
      'DATES_UNSUPPORTED_TIME_ZONE',
      `Time zone must be one of: ${SUPPORTED_TIME_ZONES.join(', ')}.`,
    );
  }
  return value;
}

export interface ZoneScope {
  /** The site's own zone, when the record belongs to a site. */
  readonly siteTimeZone?: TimeZone | null | undefined;
  /** The organization's zone, used for organization-level records. */
  readonly organizationTimeZone: TimeZone;
}

/** A site's zone wins; organization-level records use the organization's zone. */
export function effectiveTimeZone(scope: ZoneScope): TimeZone {
  return scope.siteTimeZone ?? scope.organizationTimeZone;
}

export interface WallTime {
  readonly hour: number;
  readonly minute: number;
  readonly second?: number;
  readonly millisecond?: number;
}

export interface ZonedDateTime {
  readonly timeZone: TimeZone;
  readonly date: CalendarDate;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
  /** Offset from UTC in minutes, e.g. −300 for EST, −240 for EDT. */
  readonly offsetMinutes: number;
}

function makeFormatter(timeZone: TimeZone): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Zone rules come from the runtime's IANA data (Intl, ICU). Built once per zone.
const FORMATTERS: Readonly<Record<TimeZone, Intl.DateTimeFormat>> = {
  'America/New_York': makeFormatter('America/New_York'),
  'America/Chicago': makeFormatter('America/Chicago'),
};

interface WallFields {
  readonly date: CalendarDate;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** The wall-clock reading (to the second) as if it were UTC epoch ms. */
  readonly wallMs: number;
}

function wallFields(instant: Instant, timeZone: TimeZone): WallFields {
  const fields: Partial<Record<string, string>> = {};
  for (const part of FORMATTERS[timeZone].formatToParts(instant)) {
    fields[part.type] = part.value;
  }
  const date = calendarDate(Number(fields.year), Number(fields.month), Number(fields.day));
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  const second = Number(fields.second);
  const wallMs =
    toEpochDay(date) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND;
  return { date, hour, minute, second, wallMs };
}

function millisecondOf(instant: Instant): number {
  return ((instant % MS_PER_SECOND) + MS_PER_SECOND) % MS_PER_SECOND;
}

/** UTC offset of `timeZone` at `instant`, in minutes. */
export function offsetMinutesAt(instant: Instant, timeZone: TimeZone): number {
  const { wallMs } = wallFields(instant, timeZone);
  return (wallMs - (instant - millisecondOf(instant))) / MS_PER_MINUTE;
}

export function toZonedDateTime(instant: Instant, timeZone: TimeZone): ZonedDateTime {
  const f = wallFields(instant, timeZone);
  const millisecond = millisecondOf(instant);
  return {
    timeZone,
    date: f.date,
    hour: f.hour,
    minute: f.minute,
    second: f.second,
    millisecond,
    offsetMinutes: (f.wallMs - (instant - millisecond)) / MS_PER_MINUTE,
  };
}

/** The calendar date an instant falls on at a site in `timeZone`. */
export function toZonedDate(instant: Instant, timeZone: TimeZone): CalendarDate {
  return wallFields(instant, timeZone).date;
}

/**
 * Converts a local wall-clock time in `timeZone` to an instant.
 *
 * DST is resolved like Temporal's `disambiguation: 'compatible'`:
 * - a time skipped by the spring-forward gap (02:30 on the March Sunday) moves
 *   forward by the gap length (03:30 daylight time);
 * - a time repeated by the fall-back overlap (01:30 on the November Sunday)
 *   resolves to the earlier instant (daylight time).
 */
export function zonedDateTimeToInstant(
  date: CalendarDate,
  time: WallTime,
  timeZone: TimeZone,
): Instant {
  const { hour, minute, second = 0, millisecond = 0 } = time;
  try {
    assertInteger(hour, 'hour', 0, 23);
    assertInteger(minute, 'minute', 0, 59);
    assertInteger(second, 'second', 0, 59);
    assertInteger(millisecond, 'millisecond', 0, 999);
  } catch {
    throw new DatesError('DATES_INVALID_TIME', 'Expected a wall-clock time within one day.');
  }
  const localMs =
    toEpochDay(date) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    millisecond;
  // Offsets a day either side bracket any transition near this wall time
  // (US transitions are months apart).
  const offsetBefore = offsetMinutesAt(
    instantFromEpochMilliseconds(localMs - MS_PER_DAY),
    timeZone,
  );
  const offsetAfter = offsetMinutesAt(instantFromEpochMilliseconds(localMs + MS_PER_DAY), timeZone);
  const withBefore = localMs - offsetBefore * MS_PER_MINUTE;
  const withAfter = localMs - offsetAfter * MS_PER_MINUTE;
  const beforeValid =
    offsetMinutesAt(instantFromEpochMilliseconds(withBefore), timeZone) === offsetBefore;
  const afterValid =
    offsetMinutesAt(instantFromEpochMilliseconds(withAfter), timeZone) === offsetAfter;
  if (beforeValid && afterValid) {
    // Same instant away from a transition; in an overlap, the earlier one.
    return instantFromEpochMilliseconds(Math.min(withBefore, withAfter));
  }
  if (afterValid) return instantFromEpochMilliseconds(withAfter);
  // Either only the pre-transition offset fits, or the time is in a gap: the
  // pre-transition offset then lands the gap length later, as 'compatible' does.
  return instantFromEpochMilliseconds(withBefore);
}

/** The first instant of `date` in `timeZone` (local midnight). */
export function startOfDayInZone(date: CalendarDate, timeZone: TimeZone): Instant {
  return zonedDateTimeToInstant(date, { hour: 0, minute: 0 }, timeZone);
}
