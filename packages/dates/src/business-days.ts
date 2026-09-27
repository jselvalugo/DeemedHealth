import { type CalendarDate, addDays, calendarDate, isoDayOfWeek } from './calendar-date.js';
import { DatesError, assertInteger } from './errors.js';

/**
 * Which dates are holidays. Injected by the caller: which holidays a health
 * center observes is organization data, not something this package decides.
 */
export interface HolidayCalendar {
  isHoliday(date: CalendarDate): boolean;
}

export const NO_HOLIDAYS: HolidayCalendar = { isHoliday: () => false };

export function holidayCalendar(dates: Iterable<CalendarDate>): HolidayCalendar {
  const set = new Set<string>(dates);
  return { isHoliday: (date) => set.has(date) };
}

/** How to move a date that is not a business day. */
export type BusinessDayRoll = 'none' | 'following' | 'preceding';

// A search that finds no business day in a year means the calendar is broken.
const MAX_SCAN_DAYS = 366;

export function isWeekend(date: CalendarDate): boolean {
  return isoDayOfWeek(date) >= 6;
}

export function isBusinessDay(
  date: CalendarDate,
  holidays: HolidayCalendar = NO_HOLIDAYS,
): boolean {
  return !isWeekend(date) && !holidays.isHoliday(date);
}

function scan(start: CalendarDate, step: 1 | -1, holidays: HolidayCalendar): CalendarDate {
  let date = start;
  for (let i = 0; i <= MAX_SCAN_DAYS; i += 1) {
    if (isBusinessDay(date, holidays)) return date;
    date = addDays(date, step);
  }
  throw new DatesError('DATES_NO_BUSINESS_DAY', 'No business day found within a year.');
}

export function nextBusinessDayOnOrAfter(
  date: CalendarDate,
  holidays: HolidayCalendar = NO_HOLIDAYS,
): CalendarDate {
  return scan(date, 1, holidays);
}

export function previousBusinessDayOnOrBefore(
  date: CalendarDate,
  holidays: HolidayCalendar = NO_HOLIDAYS,
): CalendarDate {
  return scan(date, -1, holidays);
}

/** Applies a roll convention: 'none' keeps the date, 'following'/'preceding' move it. */
export function rollToBusinessDay(
  date: CalendarDate,
  roll: BusinessDayRoll,
  holidays: HolidayCalendar = NO_HOLIDAYS,
): CalendarDate {
  switch (roll) {
    case 'none':
      return date;
    case 'following':
      return nextBusinessDayOnOrAfter(date, holidays);
    case 'preceding':
      return previousBusinessDayOnOrBefore(date, holidays);
  }
}

/**
 * Moves `count` business days forward (or back when negative). Counting starts
 * after `date`, so Friday + 1 = Monday. `count` 0 returns `date` unchanged.
 */
export function addBusinessDays(
  date: CalendarDate,
  count: number,
  holidays: HolidayCalendar = NO_HOLIDAYS,
): CalendarDate {
  assertInteger(count, 'count', -3660, 3660);
  const step = count < 0 ? -1 : 1;
  let result = date;
  for (let remaining = Math.abs(count); remaining > 0; remaining -= 1) {
    result = scan(addDays(result, step), step, holidays);
  }
  return result;
}

/** The first business day of a month ("due the first business day of each month"). */
export function firstBusinessDayOfMonth(
  year: number,
  month: number,
  holidays: HolidayCalendar = NO_HOLIDAYS,
): CalendarDate {
  return nextBusinessDayOnOrAfter(calendarDate(year, month, 1), holidays);
}
