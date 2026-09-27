import { describe, expect, it } from 'vitest';
import {
  type Cadence,
  cadence,
  nextDueFromLastVerification,
  nextOccurrenceOnOrAfter,
  nthOccurrence,
  occurrences,
} from './cadence.js';
import { type CalendarDate, parseCalendarDate } from './calendar-date.js';
import { DatesError } from './errors.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable();
  } catch (e) {
    expect((e as DatesError).code).toBe('DATES_INVALID_ARGUMENT');
  }
}

describe('cadence', () => {
  it('requires a positive integer', () => {
    expect(cadence(24, 'month')).toEqual({ every: 24, unit: 'month' });
    expectInvalid(() => cadence(0, 'month'));
    expectInvalid(() => cadence(1.5, 'year'));
  });
});

describe('nthOccurrence', () => {
  it.each([
    [cadence(10, 'day'), 3, '2026-10-27'],
    [cadence(2, 'week'), 2, '2026-10-25'],
    [cadence(3, 'month'), 2, '2027-03-27'],
    [cadence(2, 'year'), 1, '2028-09-27'],
    [cadence(1, 'month'), 0, '2026-09-27'],
  ])('%o × %i from 2026-09-27', (c, n, expected) => {
    expect(nthOccurrence(d('2026-09-27'), c, n)).toBe(expected);
  });

  it('rejects a hand-built invalid cadence and a negative n', () => {
    const bad: Cadence = { every: 0, unit: 'month' };
    expectInvalid(() => nthOccurrence(d('2026-09-27'), bad, 1));
    expectInvalid(() => nthOccurrence(d('2026-09-27'), cadence(1, 'month'), -1));
  });
});

describe('occurrences (anchored, no month-end drift)', () => {
  it('keeps the 31st after passing through February', () => {
    expect(occurrences(d('2027-01-31'), cadence(1, 'month'), 4)).toEqual([
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
    ]);
    expect(occurrences(d('2028-01-31'), cadence(1, 'month'), 2)).toEqual([
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('keeps Feb 29 on leap years for a yearly series', () => {
    expect(occurrences(d('2028-02-29'), cadence(1, 'year'), 4)).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('returns nothing for count 0 and rejects a bad count', () => {
    expect(occurrences(d('2028-02-29'), cadence(1, 'year'), 0)).toEqual([]);
    expectInvalid(() => occurrences(d('2028-02-29'), cadence(1, 'year'), -1));
  });
});

describe('nextOccurrenceOnOrAfter', () => {
  it.each([
    // Day and week series.
    ['2026-01-01', cadence(30, 'day'), '2026-03-02', '2026-03-02'],
    ['2026-01-01', cadence(30, 'day'), '2026-03-03', '2026-04-01'],
    ['2026-01-01', cadence(1, 'week'), '2026-01-09', '2026-01-15'],
    // Month series: estimate is exact, or one step short.
    ['2026-01-20', cadence(1, 'month'), '2026-03-15', '2026-03-20'],
    ['2026-01-20', cadence(1, 'month'), '2026-03-20', '2026-03-20'],
    ['2026-01-20', cadence(1, 'month'), '2026-03-25', '2026-04-20'],
    ['2026-01-31', cadence(1, 'month'), '2026-02-28', '2026-02-28'],
    ['2026-01-31', cadence(1, 'month'), '2026-03-01', '2026-03-31'],
    ['2026-01-31', cadence(3, 'month'), '2026-05-15', '2026-07-31'],
    ['2028-02-29', cadence(1, 'year'), '2031-06-01', '2032-02-29'],
    // A date on or before the anchor gives the first occurrence after it.
    ['2026-06-15', cadence(1, 'month'), '2026-06-15', '2026-07-15'],
    ['2026-06-15', cadence(1, 'year'), '2020-01-01', '2027-06-15'],
    ['2026-06-15', cadence(7, 'day'), '2020-01-01', '2026-06-22'],
  ])('anchor %s %o on or after %s = %s', (anchor, c, on, expected) => {
    expect(nextOccurrenceOnOrAfter(d(anchor), c, d(on))).toBe(expected);
  });

  it('agrees with a brute-force scan', () => {
    const anchor = d('2027-01-31');
    const c = cadence(2, 'month');
    const series = occurrences(anchor, c, 40);
    for (let day = 0; day < 365 * 6; day += 3) {
      const on = parseCalendarDate(new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10));
      expect(nextOccurrenceOnOrAfter(anchor, c, on)).toBe(series.find((s) => s >= on));
    }
  });

  it('rejects an invalid cadence', () => {
    expectInvalid(() =>
      nextOccurrenceOnOrAfter(d('2026-01-01'), { every: -1, unit: 'day' }, d('2026-02-01')),
    );
  });
});

describe('nextDueFromLastVerification', () => {
  it.each([
    ['2026-08-31', 6, '2027-02-28'],
    ['2027-08-31', 6, '2028-02-29'],
    ['2026-09-27', 24, '2028-09-27'],
    ['2028-02-29', 12, '2029-02-28'],
    ['2026-05-31', 1, '2026-06-30'],
  ])('verified %s, every %i months, due %s', (last, months, due) => {
    expect(nextDueFromLastVerification(d(last), months)).toBe(due);
  });

  it('re-anchors on the actual verification date', () => {
    // Verified late (Mar 10 instead of Feb 28): the next is 6 months from Mar 10.
    const first = nextDueFromLastVerification(d('2026-08-31'), 6);
    expect(first).toBe('2027-02-28');
    expect(nextDueFromLastVerification(d('2027-03-10'), 6)).toBe('2027-09-10');
  });

  it('rejects a non-positive interval', () => {
    expectInvalid(() => nextDueFromLastVerification(d('2026-08-31'), 0));
  });
});
