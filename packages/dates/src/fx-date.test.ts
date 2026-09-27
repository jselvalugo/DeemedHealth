// The FX-DATE-* fixtures from docs/qa/fixture-plan.md §4, run against the
// public entry point. Sites are synthetic: XYZ-S1 (Eastern), XYZ-S3 (Central).
import { describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  type Instant,
  type TimeZone,
  type ZoneScope,
  addDays,
  cadence,
  effectiveTimeZone,
  evaluateDueAt,
  fixedClock,
  formatInstant,
  isExpiredAt,
  lapsesAt,
  leadDaySchedule,
  nthOccurrence,
  occurrences,
  parseCalendarDate,
  parseInstant,
  remindersDueThrough,
  startOfDayInZone,
  todayIn,
} from './index.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);
const i = (s: string): Instant => parseInstant(s);

const ORG_ZONE: TimeZone = 'America/New_York';
const SITES: Record<'XYZ-S1' | 'XYZ-S3', ZoneScope> = {
  'XYZ-S1': { siteTimeZone: 'America/New_York', organizationTimeZone: ORG_ZONE },
  'XYZ-S3': { siteTimeZone: 'America/Chicago', organizationTimeZone: ORG_ZONE },
};
const S1 = effectiveTimeZone(SITES['XYZ-S1']);
const S3 = effectiveTimeZone(SITES['XYZ-S3']);
const LEAD_DAYS = [90, 60, 30];

describe('FX-DATE-FEB29: FL license expires on a leap day', () => {
  const expires = d('2028-02-29');

  it('warns 90/60/30 days before, on the right days, in 2028', () => {
    expect(leadDaySchedule(expires, LEAD_DAYS)).toEqual([
      { leadDays: 90, date: '2027-12-01' },
      { leadDays: 60, date: '2027-12-31' },
      { leadDays: 30, date: '2028-01-30' },
    ]);
  });

  it('is valid all of Feb 29 and expired from Mar 1 at the site', () => {
    expect(isExpiredAt(expires, i('2028-02-29T23:59:00-05:00'), S1)).toBe(false);
    expect(isExpiredAt(expires, i('2028-03-01T00:00:00-05:00'), S1)).toBe(true);
    expect(formatInstant(lapsesAt(expires, S1))).toBe('2028-03-01T05:00:00.000Z');
  });

  it('rolls a 1-year cadence into 2029 as Feb 28', () => {
    const renewal = nthOccurrence(expires, cadence(1, 'year'), 1);
    expect(renewal).toBe('2029-02-28');
    expect(leadDaySchedule(renewal, LEAD_DAYS)).toEqual([
      { leadDays: 90, date: '2028-11-30' },
      { leadDays: 60, date: '2028-12-30' },
      { leadDays: 30, date: '2029-01-29' },
    ]);
  });

  it('returns to Feb 29 in the next leap year (anchored, no drift)', () => {
    expect(occurrences(expires, cadence(1, 'year'), 4).at(-1)).toBe('2032-02-29');
  });
});

describe('FX-DATE-MONTHEND: Jan 31 with a monthly cadence', () => {
  it('gives Feb 28 then Mar 31 in a common year', () => {
    expect(occurrences(d('2027-01-31'), cadence(1, 'month'), 2)).toEqual([
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('gives Feb 29 then Mar 31 in a leap year', () => {
    expect(occurrences(d('2028-01-31'), cadence(1, 'month'), 2)).toEqual([
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('never drifts to the 28th over a year', () => {
    const days = occurrences(d('2027-01-31'), cadence(1, 'month'), 12).map((x) => x.slice(8));
    expect(days).toEqual(['28', '31', '30', '31', '30', '31', '31', '30', '31', '30', '31', '31']);
  });
});

describe('FX-DATE-TZ-E: end-of-day expiration at XYZ-S1 (America/New_York)', () => {
  it('expires from 00:00 ET the next day: 04:00 UTC in daylight time', () => {
    const exp = d('2027-06-30');
    expect(formatInstant(lapsesAt(exp, S1))).toBe('2027-07-01T04:00:00.000Z');
    expect(isExpiredAt(exp, i('2027-07-01T03:59:59.999Z'), S1)).toBe(false);
    expect(isExpiredAt(exp, i('2027-07-01T04:00:00Z'), S1)).toBe(true);
  });

  it('expires from 00:00 ET the next day: 05:00 UTC in standard time', () => {
    const exp = d('2027-01-15');
    expect(formatInstant(lapsesAt(exp, S1))).toBe('2027-01-16T05:00:00.000Z');
    expect(isExpiredAt(exp, i('2027-01-16T04:59:59.999Z'), S1)).toBe(false);
    expect(isExpiredAt(exp, i('2027-01-16T05:00:00Z'), S1)).toBe(true);
  });
});

describe('FX-DATE-TZ-C: the same date at XYZ-S3 (America/Chicago)', () => {
  it.each(['2027-06-30', '2027-01-15'])('%s expires one hour later in UTC than at XYZ-S1', (s) => {
    const exp = d(s);
    expect(lapsesAt(exp, S3) - lapsesAt(exp, S1)).toBe(3_600_000);
  });

  it('is still valid at 23:30 CT on the date, when XYZ-S1 has already expired', () => {
    const exp = d('2027-06-30');
    const at = i('2027-06-30T23:30:00-05:00'); // 23:30 CDT = 00:30 EDT on Jul 1
    expect(isExpiredAt(exp, at, S3)).toBe(false);
    expect(evaluateDueAt(exp, at, S3, { atRiskDays: 30 }).status).toBe('due_today');
    expect(isExpiredAt(exp, at, S1)).toBe(true);
    expect(evaluateDueAt(exp, at, S1, { atRiskDays: 30 }).status).toBe('overdue');
  });

  it("reads 'today' per site from the same clock (FX-PROV-MULTI shape)", () => {
    const clock = fixedClock(i('2027-07-01T04:30:00Z'));
    expect(todayIn(clock, S1)).toBe('2027-07-01');
    expect(todayIn(clock, S3)).toBe('2027-06-30');
  });
});

describe('FX-DATE-DST: due dates on DST start and end Sundays', () => {
  // [zone, date, expected UTC start of the due date, expected UTC lapse]
  const cases: [TimeZone, string, string, string][] = [
    [S1, '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    [S1, '2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    [S3, '2026-03-08', '2026-03-08T06:00:00.000Z', '2026-03-09T05:00:00.000Z'],
    [S3, '2026-11-01', '2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z'],
    [S1, '2028-03-12', '2028-03-12T05:00:00.000Z', '2028-03-13T04:00:00.000Z'],
    [S3, '2028-11-05', '2028-11-05T05:00:00.000Z', '2028-11-06T06:00:00.000Z'],
  ];

  it.each(cases)('%s %s: local day boundaries', (zone, s, start, lapse) => {
    const due = d(s);
    expect(formatInstant(startOfDayInZone(due, zone))).toBe(start);
    expect(formatInstant(lapsesAt(due, zone))).toBe(lapse);
  });

  it.each(cases)('%s %s: no off-by-one day at any hour of the Sunday', (zone, s) => {
    const due = d(s);
    const start = startOfDayInZone(due, zone);
    const end = lapsesAt(due, zone);
    const opts = { atRiskDays: 30 };
    expect(evaluateDueAt(due, (start - 1) as Instant, zone, opts)).toMatchObject({
      status: 'at_risk',
      daysUntilDue: 1,
    });
    for (let t = start; t < end; t = (t + 30 * 60_000) as Instant) {
      expect(evaluateDueAt(due, t, zone, opts).status).toBe('due_today');
    }
    expect(evaluateDueAt(due, (end - 1) as Instant, zone, opts).status).toBe('due_today');
    expect(evaluateDueAt(due, end, zone, opts)).toMatchObject({
      status: 'overdue',
      daysUntilDue: -1,
    });
  });

  it('keeps DST-spanning lead days on calendar dates', () => {
    expect(leadDaySchedule(d('2026-03-08'), [30, 0]).map((r) => r.date)).toEqual([
      '2026-02-06',
      '2026-03-08',
    ]);
    expect(addDays(d('2026-11-01'), -7)).toBe('2026-10-25');
    expect(
      remindersDueThrough(d('2026-11-08'), [7], todayIn(fixedClock(i('2026-11-01T04:00:00Z')), S1)),
    ).toEqual([{ leadDays: 7, date: '2026-11-01' }]);
  });
});
