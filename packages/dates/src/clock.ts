import type { CalendarDate } from './calendar-date.js';
import { type Instant, instantFromEpochMilliseconds } from './instant.js';
import { type TimeZone, toZonedDate } from './time-zone.js';

/**
 * The only source of "now". Services and jobs receive a Clock; tests pass
 * {@link fixedClock}. Nothing else in the codebase reads the system time.
 */
export interface Clock {
  now(): Instant;
}

/** Production clock. This is the one sanctioned read of the system time. */
export const systemClock: Clock = {
  now: () => instantFromEpochMilliseconds(Date.now()),
};

/** A clock stopped at `at`, for tests and for "as of" evaluations. */
export function fixedClock(at: Instant): Clock {
  return { now: () => at };
}

/** Today's calendar date at a site or organization in `timeZone`. */
export function todayIn(clock: Clock, timeZone: TimeZone): CalendarDate {
  return toZonedDate(clock.now(), timeZone);
}
