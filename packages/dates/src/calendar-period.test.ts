import { describe, expect, it } from 'vitest';
import { parseCalendarDate as d } from './calendar-date.js';
import { calendarPeriodAt, calendarPeriodOf, isInPeriod } from './calendar-period.js';
import { DatesError } from './errors.js';

describe('calendar periods', () => {
  it('monthly periods are calendar months, including leap and non-leap February', () => {
    expect(calendarPeriodOf(d('2028-02-10'), 1)).toMatchObject({
      start: '2028-02-01',
      end: '2028-02-29',
    });
    expect(calendarPeriodOf(d('2027-02-28'), 1)).toMatchObject({
      start: '2027-02-01',
      end: '2027-02-28',
    });
    const jan = calendarPeriodOf(d('2027-01-31'), 1);
    const feb = calendarPeriodOf(d('2027-02-01'), 1);
    expect(feb.index - jan.index).toBe(1);
    expect(calendarPeriodAt(jan.index + 1, 1)).toEqual(feb);
  });

  it('quarters and years align with the calendar year', () => {
    expect(calendarPeriodOf(d('2026-05-15'), 3)).toMatchObject({
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(calendarPeriodOf(d('2026-12-31'), 3)).toMatchObject({
      start: '2026-10-01',
      end: '2026-12-31',
    });
    expect(calendarPeriodOf(d('2026-07-04'), 12)).toMatchObject({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('tests membership inclusively', () => {
    const q = calendarPeriodOf(d('2026-05-15'), 3);
    expect(isInPeriod(d('2026-04-01'), q)).toBe(true);
    expect(isInPeriod(d('2026-06-30'), q)).toBe(true);
    expect(isInPeriod(d('2026-03-31'), q)).toBe(false);
    expect(isInPeriod(d('2026-07-01'), q)).toBe(false);
  });

  it('rejects invalid lengths and indexes outside years 1..9999', () => {
    expect(() => calendarPeriodOf(d('2026-01-01'), 0)).toThrow(DatesError);
    expect(() => calendarPeriodAt(5, 0)).toThrow(DatesError);
    expect(() => calendarPeriodAt(0, 1)).toThrow(DatesError);
    expect(() => calendarPeriodAt(120_000, 1)).toThrow(DatesError);
    expect(calendarPeriodAt(119_999, 1)).toMatchObject({ start: '9999-12-01', end: '9999-12-31' });
    expect(calendarPeriodAt(12, 1)).toMatchObject({ start: '0001-01-01' });
  });
});
