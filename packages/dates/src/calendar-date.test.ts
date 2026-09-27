import { describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  addDays,
  addMonths,
  addYears,
  calendarDate,
  compareDates,
  daysInMonth,
  differenceInDays,
  endOfMonth,
  fromEpochDay,
  isCalendarDate,
  isLeapYear,
  isoDayOfWeek,
  mod,
  parseCalendarDate,
  startOfMonth,
  toEpochDay,
  toParts,
} from './calendar-date.js';
import { DatesError } from './errors.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DatesError);
    expect((e as DatesError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('leap years and month lengths', () => {
  it.each([
    [2024, true],
    [2028, true],
    [2000, true],
    [2023, false],
    [2029, false],
    [1900, false],
    [2100, false],
  ])('isLeapYear(%i) = %s', (year, leap) => {
    expect(isLeapYear(year)).toBe(leap);
  });

  it('knows February in leap and common years and the 30/31-day months', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2029, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('rejects an invalid month', () => {
    expectCode(() => daysInMonth(2026, 13), 'DATES_INVALID_ARGUMENT');
    expectCode(() => daysInMonth(2026, 0), 'DATES_INVALID_ARGUMENT');
  });
});

describe('constructing and parsing', () => {
  it('builds valid dates, including Feb 29 in a leap year', () => {
    expect(calendarDate(2028, 2, 29)).toBe('2028-02-29');
    expect(calendarDate(1, 1, 1)).toBe('0001-01-01');
    expect(calendarDate(9999, 12, 31)).toBe('9999-12-31');
  });

  it.each([
    [2027, 2, 29],
    [2026, 0, 1],
    [2026, 13, 1],
    [2026, 4, 31],
    [2026, 1, 0],
    [0, 1, 1],
    [10000, 1, 1],
    [2026.5, 1, 1],
    [2026, 1.5, 1],
    [2026, 1, 1.5],
  ])('rejects %i-%i-%i', (y, m, day) => {
    expectCode(() => calendarDate(y, m, day), 'DATES_INVALID_CALENDAR_DATE');
  });

  it('recognizes only strict YYYY-MM-DD strings', () => {
    expect(isCalendarDate('2026-09-27')).toBe(true);
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('2026-9-27')).toBe(false);
    expect(isCalendarDate('2026-09-27T00:00:00Z')).toBe(false);
    expect(isCalendarDate(20260927)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });

  it('parses and throws a stable code without echoing the value', () => {
    expect(parseCalendarDate('2026-09-27')).toBe('2026-09-27');
    try {
      parseCalendarDate('1999-02-30');
      expect.unreachable();
    } catch (e) {
      expect((e as DatesError).code).toBe('DATES_INVALID_CALENDAR_DATE');
      expect((e as DatesError).name).toBe('DatesError');
      expect((e as DatesError).message).not.toContain('1999');
    }
  });

  it('splits into parts', () => {
    expect(toParts(d('2028-02-29'))).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe('epoch-day conversion', () => {
  it('matches the ECMAScript UTC calendar for every day from 1899 to 2101', () => {
    const start = Date.UTC(1899, 0, 1) / 86_400_000;
    const end = Date.UTC(2101, 11, 31) / 86_400_000;
    const mismatches: number[] = [];
    for (let day = start; day <= end; day += 1) {
      const iso = new Date(day * 86_400_000).toISOString().slice(0, 10);
      if (fromEpochDay(day) !== iso || toEpochDay(iso as CalendarDate) !== day) {
        mismatches.push(day);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('handles the extremes of the supported range', () => {
    expect(fromEpochDay(toEpochDay(d('0001-01-01')))).toBe('0001-01-01');
    expect(fromEpochDay(toEpochDay(d('9999-12-31')))).toBe('9999-12-31');
    expect(toEpochDay(d('1970-01-01'))).toBe(0);
  });

  it('refuses to leave years 0001-9999', () => {
    expectCode(() => addDays(d('0001-01-01'), -1), 'DATES_OUT_OF_RANGE');
    expectCode(() => addDays(d('9999-12-31'), 1), 'DATES_OUT_OF_RANGE');
  });

  it('uses a non-negative modulo', () => {
    expect(mod(-1, 7)).toBe(6);
    expect(mod(8, 7)).toBe(1);
  });
});

describe('addDays', () => {
  it('crosses month, year, and leap-day boundaries', () => {
    expect(addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(d('2029-02-28'), 1)).toBe('2029-03-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2028-03-01'), -1)).toBe('2028-02-29');
    expect(addDays(d('2026-09-27'), 0)).toBe('2026-09-27');
  });

  it('rejects non-integers', () => {
    expectCode(() => addDays(d('2026-09-27'), 1.5), 'DATES_INVALID_ARGUMENT');
    expectCode(() => addDays(d('2026-09-27'), Number.NaN), 'DATES_INVALID_ARGUMENT');
  });
});

describe('addMonths (month-end clamping)', () => {
  it.each([
    ['2027-01-31', 1, '2027-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2027-01-31', 2, '2027-03-31'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2028-03-31', -1, '2028-02-29'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-11-15', 3, '2027-02-15'],
    ['2027-02-15', -3, '2026-11-15'],
    ['2026-01-15', -13, '2024-12-15'],
    ['2026-01-15', 0, '2026-01-15'],
    ['2026-09-27', 1200, '2126-09-27'],
  ])('%s + %i months = %s', (from, n, to) => {
    expect(addMonths(d(from), n)).toBe(to);
  });

  it('refuses to leave the supported range', () => {
    expectCode(() => addMonths(d('0001-01-15'), -1), 'DATES_OUT_OF_RANGE');
    expectCode(() => addMonths(d('9999-12-15'), 1), 'DATES_OUT_OF_RANGE');
  });

  it('rejects non-integers', () => {
    expectCode(() => addMonths(d('2026-01-15'), 0.5), 'DATES_INVALID_ARGUMENT');
  });
});

describe('addYears', () => {
  it('clamps Feb 29 to Feb 28 in common years and keeps it in leap years', () => {
    expect(addYears(d('2028-02-29'), 1)).toBe('2029-02-28');
    expect(addYears(d('2028-02-29'), 4)).toBe('2032-02-29');
    expect(addYears(d('2028-02-29'), -4)).toBe('2024-02-29');
    expect(addYears(d('2028-02-29'), -1)).toBe('2027-02-28');
    expect(addYears(d('2024-02-29'), 100)).toBe('2124-02-29');
    expect(addYears(d('2096-02-29'), 4)).toBe('2100-02-28');
  });

  it('rejects non-integers', () => {
    expectCode(() => addYears(d('2028-02-29'), 1.5), 'DATES_INVALID_ARGUMENT');
  });
});

describe('comparison and weekdays', () => {
  it('computes signed day differences across a leap day', () => {
    expect(differenceInDays(d('2028-03-01'), d('2028-02-28'))).toBe(2);
    expect(differenceInDays(d('2029-03-01'), d('2029-02-28'))).toBe(1);
    expect(differenceInDays(d('2026-01-01'), d('2027-01-01'))).toBe(-365);
  });

  it('compares', () => {
    expect(compareDates(d('2026-01-01'), d('2026-01-02'))).toBe(-1);
    expect(compareDates(d('2026-01-02'), d('2026-01-01'))).toBe(1);
    expect(compareDates(d('2026-01-01'), d('2026-01-01'))).toBe(0);
  });

  it('returns ISO weekdays', () => {
    expect(isoDayOfWeek(d('2026-09-28'))).toBe(1); // Monday
    expect(isoDayOfWeek(d('2026-10-01'))).toBe(4); // Thursday
    expect(isoDayOfWeek(d('2026-09-27'))).toBe(7); // Sunday
    expect(isoDayOfWeek(d('1969-12-31'))).toBe(3); // Wednesday, before the epoch
    expect(isoDayOfWeek(d('2028-02-29'))).toBe(2); // Tuesday
  });

  it('finds month starts and ends', () => {
    expect(startOfMonth(d('2028-02-17'))).toBe('2028-02-01');
    expect(endOfMonth(d('2028-02-17'))).toBe('2028-02-29');
    expect(endOfMonth(d('2029-02-17'))).toBe('2029-02-28');
    expect(endOfMonth(d('2026-04-01'))).toBe('2026-04-30');
  });
});
