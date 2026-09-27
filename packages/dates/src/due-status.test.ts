import { describe, expect, it } from 'vitest';
import { type CalendarDate, parseCalendarDate } from './calendar-date.js';
import { evaluateDueAt, evaluateDueOnDate, isExpiredAt, lapsesAt } from './due-status.js';
import { DatesError } from './errors.js';
import { type Instant, formatInstant, parseInstant } from './instant.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);
const i = (s: string): Instant => parseInstant(s);

describe('evaluateDueOnDate', () => {
  const due = d('2027-06-30');

  it.each([
    ['2027-05-30', 'not_due', 31],
    ['2027-05-31', 'at_risk', 30],
    ['2027-06-29', 'at_risk', 1],
    ['2027-06-30', 'due_today', 0],
    ['2027-07-01', 'overdue', -1],
    ['2028-06-30', 'overdue', -366],
  ])('as of %s: %s (%i days)', (asOf, status, days) => {
    expect(evaluateDueOnDate(due, d(asOf), { atRiskDays: 30 })).toEqual({
      status,
      asOfDate: asOf,
      daysUntilDue: days,
    });
  });

  it('never reports at_risk when atRiskDays is 0', () => {
    expect(evaluateDueOnDate(due, d('2027-06-29'), { atRiskDays: 0 }).status).toBe('not_due');
  });

  it('rejects a negative or fractional window', () => {
    expect(() => evaluateDueOnDate(due, due, { atRiskDays: -1 })).toThrow(DatesError);
    expect(() => evaluateDueOnDate(due, due, { atRiskDays: 1.5 })).toThrow(DatesError);
  });
});

describe('evaluateDueAt', () => {
  it("uses the site's local date", () => {
    const at = i('2027-07-01T04:30:00Z'); // 00:30 EDT Jul 1, 23:30 CDT Jun 30
    const due = d('2027-06-30');
    expect(evaluateDueAt(due, at, 'America/New_York', { atRiskDays: 30 }).status).toBe('overdue');
    expect(evaluateDueAt(due, at, 'America/Chicago', { atRiskDays: 30 }).status).toBe('due_today');
  });
});

describe('lapsesAt and isExpiredAt', () => {
  it('lapses at local midnight after the date', () => {
    expect(formatInstant(lapsesAt(d('2027-06-30'), 'America/New_York'))).toBe(
      '2027-07-01T04:00:00.000Z',
    );
    expect(formatInstant(lapsesAt(d('2027-12-31'), 'America/New_York'))).toBe(
      '2028-01-01T05:00:00.000Z',
    );
    expect(formatInstant(lapsesAt(d('2027-06-30'), 'America/Chicago'))).toBe(
      '2027-07-01T05:00:00.000Z',
    );
  });

  it('is valid through the last millisecond of the date', () => {
    const exp = d('2027-06-30');
    expect(isExpiredAt(exp, i('2027-07-01T03:59:59.999Z'), 'America/New_York')).toBe(false);
    expect(isExpiredAt(exp, i('2027-07-01T04:00:00Z'), 'America/New_York')).toBe(true);
  });
});
