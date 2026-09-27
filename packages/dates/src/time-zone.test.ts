import { describe, expect, it } from 'vitest';
import { type CalendarDate, parseCalendarDate } from './calendar-date.js';
import { DatesError } from './errors.js';
import { type Instant, MS_PER_MINUTE, formatInstant, parseInstant } from './instant.js';
import {
  SUPPORTED_TIME_ZONES,
  type TimeZone,
  effectiveTimeZone,
  isSupportedTimeZone,
  offsetMinutesAt,
  parseTimeZone,
  startOfDayInZone,
  toZonedDate,
  toZonedDateTime,
  zonedDateTimeToInstant,
} from './time-zone.js';

const d = (s: string): CalendarDate => parseCalendarDate(s);
const i = (s: string): Instant => parseInstant(s);
const ET: TimeZone = 'America/New_York';
const CT: TimeZone = 'America/Chicago';

describe('supported zones', () => {
  it('allows only the two Florida zones', () => {
    expect(SUPPORTED_TIME_ZONES).toEqual(['America/New_York', 'America/Chicago']);
    expect(isSupportedTimeZone(ET)).toBe(true);
    expect(isSupportedTimeZone(CT)).toBe(true);
    expect(isSupportedTimeZone('America/Los_Angeles')).toBe(false);
    expect(isSupportedTimeZone('UTC')).toBe(false);
    expect(isSupportedTimeZone(undefined)).toBe(false);
  });

  it('parses or throws a stable code', () => {
    expect(parseTimeZone('America/Chicago')).toBe(CT);
    expect(() => parseTimeZone('US/Eastern')).toThrow(DatesError);
    try {
      parseTimeZone('Europe/Madrid');
    } catch (e) {
      expect((e as DatesError).code).toBe('DATES_UNSUPPORTED_TIME_ZONE');
    }
  });

  it("uses the site's zone first, then the organization's", () => {
    expect(effectiveTimeZone({ siteTimeZone: CT, organizationTimeZone: ET })).toBe(CT);
    expect(effectiveTimeZone({ siteTimeZone: null, organizationTimeZone: ET })).toBe(ET);
    expect(effectiveTimeZone({ organizationTimeZone: CT })).toBe(CT);
  });
});

describe('offsets', () => {
  it.each([
    [ET, '2026-01-15T12:00:00Z', -300],
    [ET, '2026-07-15T12:00:00Z', -240],
    [CT, '2026-01-15T12:00:00Z', -360],
    [CT, '2026-07-15T12:00:00Z', -300],
    // The switch instants themselves.
    [ET, '2026-03-08T06:59:59.999Z', -300],
    [ET, '2026-03-08T07:00:00Z', -240],
    [ET, '2026-11-01T05:59:59.999Z', -240],
    [ET, '2026-11-01T06:00:00Z', -300],
    [CT, '2026-03-08T07:59:59.999Z', -360],
    [CT, '2026-03-08T08:00:00Z', -300],
    [CT, '2026-11-01T06:59:59.999Z', -300],
    [CT, '2026-11-01T07:00:00Z', -360],
  ])('%s at %s is %i minutes', (zone, at, offset) => {
    expect(offsetMinutesAt(i(at), zone)).toBe(offset);
  });
});

describe('instant to local', () => {
  it('reads the wall clock with milliseconds and offset', () => {
    expect(toZonedDateTime(i('2026-09-27T03:30:15.250Z'), ET)).toEqual({
      timeZone: ET,
      date: '2026-09-26',
      hour: 23,
      minute: 30,
      second: 15,
      millisecond: 250,
      offsetMinutes: -240,
    });
    expect(toZonedDateTime(i('1969-12-31T23:59:59.999Z'), CT)).toMatchObject({
      date: '1969-12-31',
      hour: 17,
      millisecond: 999,
      offsetMinutes: -360,
    });
  });

  it('puts the same instant on different local dates in Eastern and Central', () => {
    const at = i('2026-09-27T04:30:00Z'); // 00:30 EDT, 23:30 CDT the day before
    expect(toZonedDate(at, ET)).toBe('2026-09-27');
    expect(toZonedDate(at, CT)).toBe('2026-09-26');
  });
});

describe('local to instant', () => {
  it('converts ordinary wall times', () => {
    expect(formatInstant(zonedDateTimeToInstant(d('2026-09-27'), { hour: 8, minute: 0 }, ET))).toBe(
      '2026-09-27T12:00:00.000Z',
    );
    expect(
      formatInstant(
        zonedDateTimeToInstant(
          d('2026-01-15'),
          { hour: 23, minute: 59, second: 59, millisecond: 999 },
          CT,
        ),
      ),
    ).toBe('2026-01-16T05:59:59.999Z');
  });

  it.each([
    // Spring forward: 02:00-02:59 does not exist; 'compatible' moves it forward.
    [ET, '2026-03-08', 2, 30, '2026-03-08T07:30:00.000Z'],
    [CT, '2026-03-08', 2, 30, '2026-03-08T08:30:00.000Z'],
    // Just before and just after the gap.
    [ET, '2026-03-08', 1, 30, '2026-03-08T06:30:00.000Z'],
    [ET, '2026-03-08', 3, 30, '2026-03-08T07:30:00.000Z'],
    [CT, '2026-03-08', 1, 30, '2026-03-08T07:30:00.000Z'],
    [CT, '2026-03-08', 3, 30, '2026-03-08T08:30:00.000Z'],
    // Fall back: 01:00-01:59 happens twice; the earlier (daylight) instant wins.
    [ET, '2026-11-01', 1, 30, '2026-11-01T05:30:00.000Z'],
    [CT, '2026-11-01', 1, 30, '2026-11-01T06:30:00.000Z'],
    [ET, '2026-11-01', 0, 30, '2026-11-01T04:30:00.000Z'],
    [ET, '2026-11-01', 2, 30, '2026-11-01T07:30:00.000Z'],
    // 2028 transitions (March 12, November 5).
    [ET, '2028-03-12', 2, 0, '2028-03-12T07:00:00.000Z'],
    [CT, '2028-11-05', 1, 0, '2028-11-05T06:00:00.000Z'],
  ])('%s %s %i:%i -> %s', (zone, date, hour, minute, expected) => {
    expect(formatInstant(zonedDateTimeToInstant(d(date), { hour, minute }, zone))).toBe(expected);
  });

  it.each([
    { hour: 24, minute: 0 },
    { hour: -1, minute: 0 },
    { hour: 1, minute: 60 },
    { hour: 1, minute: 0, second: 60 },
    { hour: 1, minute: 0, millisecond: 1000 },
    { hour: 1.5, minute: 0 },
  ])('rejects %o', (time) => {
    try {
      zonedDateTimeToInstant(d('2026-09-27'), time, ET);
      expect.unreachable();
    } catch (e) {
      expect((e as DatesError).code).toBe('DATES_INVALID_TIME');
    }
  });

  it('finds local midnight on DST Sundays in both zones', () => {
    expect(formatInstant(startOfDayInZone(d('2026-03-08'), ET))).toBe('2026-03-08T05:00:00.000Z');
    expect(formatInstant(startOfDayInZone(d('2026-03-09'), ET))).toBe('2026-03-09T04:00:00.000Z');
    expect(formatInstant(startOfDayInZone(d('2026-11-01'), ET))).toBe('2026-11-01T04:00:00.000Z');
    expect(formatInstant(startOfDayInZone(d('2026-11-02'), ET))).toBe('2026-11-02T05:00:00.000Z');
    expect(formatInstant(startOfDayInZone(d('2026-03-08'), CT))).toBe('2026-03-08T06:00:00.000Z');
    expect(formatInstant(startOfDayInZone(d('2026-11-01'), CT))).toBe('2026-11-01T05:00:00.000Z');
  });

  it.each([ET, CT])('round-trips every 30 minutes through 2026 and 2028 in %s', (zone) => {
    const repeated: string[] = [];
    const wrong: string[] = [];
    for (const year of [2026, 2028]) {
      const start = i(`${year}-01-01T00:00:00Z`);
      const end = i(`${year + 1}-01-01T00:00:00Z`);
      for (let t = start; t < end; t = (t + 30 * MS_PER_MINUTE) as Instant) {
        const z = toZonedDateTime(t, zone);
        const back = zonedDateTimeToInstant(z.date, z, zone);
        if (back === t) continue;
        // The second pass through the fall-back hour maps to the earlier instant.
        const earlier = back === t - 60 * MS_PER_MINUTE;
        const daylight = offsetMinutesAt(back, zone) === z.offsetMinutes + 60;
        (earlier && daylight ? repeated : wrong).push(formatInstant(t));
      }
    }
    expect(wrong).toEqual([]);
    // Two half-hours of the repeated hour, in each of the two years.
    expect(repeated).toHaveLength(4);
  });
});
