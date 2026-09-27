import { describe, expect, it } from 'vitest';
import { type CalendarDate, parseCalendarDate } from './calendar-date.js';
import { DatesError } from './errors.js';
import {
  currentLeadTier,
  leadDaySchedule,
  normalizeLeadDays,
  remindersDueThrough,
} from './lead-days.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);
const STANDARD = [90, 60, 30, 0];

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable();
  } catch (e) {
    expect((e as DatesError).code).toBe('DATES_INVALID_ARGUMENT');
  }
}

describe('normalizeLeadDays', () => {
  it('sorts largest first', () => {
    expect(normalizeLeadDays([0, 30, 90, 60])).toEqual([90, 60, 30, 0]);
  });

  it('rejects empty, negative, fractional, and repeated lead days', () => {
    expectInvalid(() => normalizeLeadDays([]));
    expectInvalid(() => normalizeLeadDays([30, -1]));
    expectInvalid(() => normalizeLeadDays([30.5]));
    expectInvalid(() => normalizeLeadDays([30, 60, 30]));
  });
});

describe('leadDaySchedule', () => {
  it('counts calendar days back from the due date, earliest first', () => {
    expect(leadDaySchedule(d('2027-06-30'), STANDARD)).toEqual([
      { leadDays: 90, date: '2027-04-01' },
      { leadDays: 60, date: '2027-05-01' },
      { leadDays: 30, date: '2027-05-31' },
      { leadDays: 0, date: '2027-06-30' },
    ]);
  });

  it('crosses a leap day correctly', () => {
    expect(leadDaySchedule(d('2028-03-30'), [30])).toEqual([{ leadDays: 30, date: '2028-02-29' }]);
    expect(leadDaySchedule(d('2029-03-30'), [30])).toEqual([{ leadDays: 30, date: '2029-02-28' }]);
  });
});

describe('remindersDueThrough and currentLeadTier', () => {
  const due = d('2027-06-30');

  it('is empty before the first reminder date', () => {
    expect(remindersDueThrough(due, STANDARD, d('2027-03-31'))).toEqual([]);
    expect(currentLeadTier(due, STANDARD, d('2027-03-31'))).toBeNull();
  });

  it('includes a reminder on its own day', () => {
    expect(remindersDueThrough(due, STANDARD, d('2027-04-01'))).toEqual([
      { leadDays: 90, date: '2027-04-01' },
    ]);
    expect(currentLeadTier(due, STANDARD, d('2027-04-01'))).toBe(90);
  });

  it('catches up every missed reminder for a resumed job', () => {
    expect(remindersDueThrough(due, STANDARD, d('2027-06-01')).map((r) => r.leadDays)).toEqual([
      90, 60, 30,
    ]);
    expect(currentLeadTier(due, STANDARD, d('2027-06-01'))).toBe(30);
  });

  it('stays at the smallest tier on and after the due date', () => {
    expect(currentLeadTier(due, STANDARD, d('2027-06-30'))).toBe(0);
    expect(currentLeadTier(due, STANDARD, d('2027-08-01'))).toBe(0);
    expect(currentLeadTier(due, [60, 30], d('2027-08-01'))).toBe(30);
  });
});
