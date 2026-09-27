import { describe, expect, it } from 'vitest';
import { DatesError } from './errors.js';
import {
  type Instant,
  addMilliseconds,
  formatInstant,
  instantFromDate,
  instantFromEpochMilliseconds,
  instantToDate,
  parseInstant,
  utcDateOf,
} from './instant.js';

function expectCode(fn: () => unknown, code: string): void {
  expect(fn).toThrow(DatesError);
  try {
    fn();
  } catch (e) {
    expect((e as DatesError).code).toBe(code);
  }
}

describe('parseInstant', () => {
  it.each([
    ['2026-09-27T12:00:00Z', Date.UTC(2026, 8, 27, 12)],
    ['2026-09-27T12:00Z', Date.UTC(2026, 8, 27, 12)],
    ['2026-09-27T08:00:00-04:00', Date.UTC(2026, 8, 27, 12)],
    ['2026-09-27T17:30:00+05:30', Date.UTC(2026, 8, 27, 12)],
    ['2026-09-27T12:00:00.5Z', Date.UTC(2026, 8, 27, 12, 0, 0, 500)],
    ['2026-09-27T12:00:00.123Z', Date.UTC(2026, 8, 27, 12, 0, 0, 123)],
    ['2028-02-29T23:59:59.999-05:00', Date.UTC(2028, 2, 1, 4, 59, 59, 999)],
    ['1969-12-31T23:59:59Z', -1000],
  ])('%s', (iso, ms) => {
    expect(parseInstant(iso)).toBe(ms);
  });

  it.each([
    '2026-09-27T12:00:00', // no offset: a wall time, not an instant
    '2026-09-27',
    '2027-02-29T00:00:00Z',
    '2026-09-27T24:00:00Z',
    '2026-09-27T12:60:00Z',
    '2026-09-27T12:00:60Z',
    '2026-09-27T12:00:00+24:00',
    '2026-09-27T12:00:00+05:60',
    '2026-09-27T12:00:00.1234Z',
    'not a date',
  ])('rejects %s', (iso) => {
    expectCode(() => parseInstant(iso), 'DATES_INVALID_INSTANT');
  });
});

describe('epoch milliseconds and Date interop', () => {
  it('accepts integers in the ECMAScript range only', () => {
    expect(instantFromEpochMilliseconds(0)).toBe(0);
    expectCode(() => instantFromEpochMilliseconds(1.5), 'DATES_INVALID_INSTANT');
    expectCode(() => instantFromEpochMilliseconds(8.64e15 + 1), 'DATES_INVALID_INSTANT');
    expectCode(() => instantFromEpochMilliseconds(Number.NaN), 'DATES_INVALID_INSTANT');
  });

  it('round-trips through Date', () => {
    const i = parseInstant('2026-09-27T12:34:56.789Z');
    expect(instantFromDate(instantToDate(i))).toBe(i);
    expect(instantToDate(i).toISOString()).toBe('2026-09-27T12:34:56.789Z');
    expectCode(() => instantFromDate(new Date(Number.NaN)), 'DATES_INVALID_INSTANT');
  });
});

describe('formatting', () => {
  it('formats as UTC ISO with milliseconds', () => {
    expect(formatInstant(parseInstant('2026-09-27T08:05:09.007-04:00'))).toBe(
      '2026-09-27T12:05:09.007Z',
    );
    expect(formatInstant(-1 as Instant)).toBe('1969-12-31T23:59:59.999Z');
  });

  it('gives the UTC date', () => {
    expect(utcDateOf(parseInstant('2026-09-27T23:30:00-04:00'))).toBe('2026-09-28');
    expect(utcDateOf(-1 as Instant)).toBe('1969-12-31');
  });

  it('adds milliseconds', () => {
    expect(addMilliseconds(parseInstant('2026-09-27T12:00:00Z'), 1500)).toBe(
      parseInstant('2026-09-27T12:00:01.5Z'),
    );
  });
});
