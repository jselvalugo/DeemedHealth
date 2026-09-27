import { describe, expect, it } from 'vitest';
import {
  NO_HOLIDAYS,
  addBusinessDays,
  firstBusinessDayOfMonth,
  holidayCalendar,
  isBusinessDay,
  isWeekend,
  nextBusinessDayOnOrAfter,
  previousBusinessDayOnOrBefore,
  rollToBusinessDay,
} from './business-days.js';
import { type CalendarDate, parseCalendarDate } from './calendar-date.js';
import { DatesError } from './errors.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);

// A synthetic calendar for tests. Which holidays an organization observes is
// its own data; this package ships none.
const HOLIDAYS = holidayCalendar([d('2027-01-01'), d('2026-11-26'), d('2026-12-25')]);

describe('weekends and holidays', () => {
  it('treats Saturday and Sunday as weekend', () => {
    expect(isWeekend(d('2026-09-26'))).toBe(true); // Saturday
    expect(isWeekend(d('2026-09-27'))).toBe(true); // Sunday
    expect(isWeekend(d('2026-09-28'))).toBe(false); // Monday
    expect(isWeekend(d('2026-10-02'))).toBe(false); // Friday
  });

  it('excludes injected holidays', () => {
    expect(isBusinessDay(d('2026-11-26'))).toBe(true);
    expect(isBusinessDay(d('2026-11-26'), HOLIDAYS)).toBe(false);
    expect(isBusinessDay(d('2026-11-27'), HOLIDAYS)).toBe(true);
    expect(isBusinessDay(d('2026-11-28'), HOLIDAYS)).toBe(false);
    expect(NO_HOLIDAYS.isHoliday(d('2026-12-25'))).toBe(false);
  });
});

describe('rolling', () => {
  it('moves forward and back off weekends and holidays', () => {
    expect(nextBusinessDayOnOrAfter(d('2026-09-26'))).toBe('2026-09-28');
    expect(nextBusinessDayOnOrAfter(d('2026-09-28'))).toBe('2026-09-28');
    expect(nextBusinessDayOnOrAfter(d('2026-12-25'), HOLIDAYS)).toBe('2026-12-28');
    expect(previousBusinessDayOnOrBefore(d('2026-09-27'))).toBe('2026-09-25');
    expect(previousBusinessDayOnOrBefore(d('2027-01-03'), HOLIDAYS)).toBe('2026-12-31');
  });

  it('applies roll conventions', () => {
    expect(rollToBusinessDay(d('2026-09-27'), 'none')).toBe('2026-09-27');
    expect(rollToBusinessDay(d('2026-09-27'), 'following')).toBe('2026-09-28');
    expect(rollToBusinessDay(d('2026-09-27'), 'preceding')).toBe('2026-09-25');
    expect(rollToBusinessDay(d('2026-11-26'), 'following', HOLIDAYS)).toBe('2026-11-27');
  });

  it('fails loudly when a calendar leaves no business day', () => {
    const broken = { isHoliday: () => true };
    try {
      nextBusinessDayOnOrAfter(d('2026-09-28'), broken);
      expect.unreachable();
    } catch (e) {
      expect((e as DatesError).code).toBe('DATES_NO_BUSINESS_DAY');
    }
  });
});

describe('addBusinessDays', () => {
  it.each([
    ['2026-10-02', 1, '2026-10-05'], // Friday + 1 = Monday
    ['2026-10-05', -1, '2026-10-02'], // Monday - 1 = Friday
    ['2026-09-28', 5, '2026-10-05'],
    ['2026-09-27', 1, '2026-09-28'], // from a Sunday
    ['2026-09-27', 0, '2026-09-27'], // 0 leaves the date alone
    ['2026-09-28', 10, '2026-10-12'],
  ])('%s + %i business days = %s', (from, n, to) => {
    expect(addBusinessDays(d(from), n)).toBe(to);
  });

  it('skips holidays in both directions', () => {
    expect(addBusinessDays(d('2026-11-25'), 1, HOLIDAYS)).toBe('2026-11-27');
    expect(addBusinessDays(d('2026-12-24'), 1, HOLIDAYS)).toBe('2026-12-28');
    expect(addBusinessDays(d('2027-01-04'), -1, HOLIDAYS)).toBe('2026-12-31');
    expect(addBusinessDays(d('2026-12-31'), 2, HOLIDAYS)).toBe('2027-01-05');
  });

  it('rejects a fractional count', () => {
    try {
      addBusinessDays(d('2026-09-28'), 1.5);
      expect.unreachable();
    } catch (e) {
      expect((e as DatesError).code).toBe('DATES_INVALID_ARGUMENT');
    }
  });
});

describe('firstBusinessDayOfMonth', () => {
  it.each([
    [2026, 9, '2026-09-01'], // Tuesday
    [2026, 11, '2026-11-02'], // Nov 1 is a Sunday
    [2026, 8, '2026-08-03'], // Aug 1 is a Saturday
    [2028, 2, '2028-02-01'],
  ])('%i-%i -> %s', (y, m, expected) => {
    expect(firstBusinessDayOfMonth(y, m)).toBe(expected);
  });

  it('skips a holiday on the 1st', () => {
    // 2027-01-01 is a Friday holiday; the next business day is Monday the 4th.
    expect(firstBusinessDayOfMonth(2027, 1, HOLIDAYS)).toBe('2027-01-04');
    expect(firstBusinessDayOfMonth(2027, 1)).toBe('2027-01-01');
  });

  it('rejects an invalid month', () => {
    expect(() => firstBusinessDayOfMonth(2027, 13)).toThrow(DatesError);
  });
});
