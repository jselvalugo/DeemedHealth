import { DatesError, assertInteger } from './errors.js';

declare const calendarDateBrand: unique symbol;

/**
 * A calendar date with no time and no zone, as `YYYY-MM-DD` (Postgres `date`).
 * Branded so a plain string cannot be passed by accident; build one with
 * {@link parseCalendarDate} or {@link calendarDate}. The ISO form sorts and
 * compares correctly as a string.
 */
export type CalendarDate = string & { readonly [calendarDateBrand]: 'CalendarDate' };

export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** ISO day of week: 1 = Monday … 7 = Sunday. */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const MAX_STEP = 10_000 * 366;

/** @internal Non-negative modulo. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  assertInteger(month, 'month', 1, 12);
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] as number);
}

function isValidParts(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

function outOfRange(): DatesError {
  return new DatesError('DATES_OUT_OF_RANGE', `Date is outside years ${MIN_YEAR}-${MAX_YEAR}.`);
}

function format(year: number, month: number, day: number): CalendarDate {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}` as CalendarDate;
}

/** Builds a date from parts; throws `DATES_INVALID_CALENDAR_DATE` for e.g. 2027-02-29. */
export function calendarDate(year: number, month: number, day: number): CalendarDate {
  if (!isValidParts(year, month, day)) {
    throw new DatesError('DATES_INVALID_CALENDAR_DATE', 'Not a valid calendar date.');
  }
  return format(year, month, day);
}

export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  return m !== null && isValidParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Parses strict `YYYY-MM-DD`. No times, no offsets, no lenient rollover. */
export function parseCalendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) {
    throw new DatesError('DATES_INVALID_CALENDAR_DATE', 'Expected a calendar date as YYYY-MM-DD.');
  }
  return value;
}

export function toParts(date: CalendarDate): CalendarDateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

// Days since 1970-01-01 in the proleptic Gregorian calendar (H. Hinnant,
// "chrono-compatible low-level date algorithms"). Pure integer math with no
// Date object, so the host time zone can never leak in.

/** @internal */
export function toEpochDay(date: CalendarDate): number {
  const { year, month, day } = toParts(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** @internal */
export function fromEpochDay(epochDay: number): CalendarDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  if (year < MIN_YEAR || year > MAX_YEAR) throw outOfRange();
  return format(year, month, day);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  assertInteger(days, 'days', -MAX_STEP, MAX_STEP);
  return fromEpochDay(toEpochDay(date) + days);
}

/**
 * Adds calendar months, clamping to the last day of the target month:
 * Jan 31 + 1 month = Feb 28 (Feb 29 in a leap year); Mar 31 − 1 month = Feb 28/29.
 * The result never rolls into the following month.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  assertInteger(months, 'months', -MAX_STEP, MAX_STEP);
  const { year, month, day } = toParts(date);
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = mod(total, 12) + 1;
  if (newYear < MIN_YEAR || newYear > MAX_YEAR) throw outOfRange();
  return format(newYear, newMonth, Math.min(day, daysInMonth(newYear, newMonth)));
}

/** Adds years with month-end clamping: 2028-02-29 + 1 year = 2029-02-28. */
export function addYears(date: CalendarDate, years: number): CalendarDate {
  assertInteger(years, 'years', -MAX_YEAR, MAX_YEAR);
  return addMonths(date, years * 12);
}

/** `later − earlier` in whole days (negative when `later` is before `earlier`). */
export function differenceInDays(later: CalendarDate, earlier: CalendarDate): number {
  return toEpochDay(later) - toEpochDay(earlier);
}

export function compareDates(a: CalendarDate, b: CalendarDate): -1 | 0 | 1 {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function isoDayOfWeek(date: CalendarDate): IsoDayOfWeek {
  // 1970-01-01 was a Thursday (ISO 4).
  return (mod(toEpochDay(date) + 3, 7) + 1) as IsoDayOfWeek;
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = toParts(date);
  return format(year, month, 1);
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = toParts(date);
  return format(year, month, daysInMonth(year, month));
}
