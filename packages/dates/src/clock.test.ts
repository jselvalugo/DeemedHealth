import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock, todayIn } from './clock.js';
import { parseInstant } from './instant.js';

describe('clock', () => {
  it('reads system time only through systemClock', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('stops a fixed clock', () => {
    const at = parseInstant('2026-09-27T12:00:00Z');
    const clock = fixedClock(at);
    expect(clock.now()).toBe(at);
    expect(clock.now()).toBe(at);
  });

  it("gives today's date in the site's zone", () => {
    const clock = fixedClock(parseInstant('2026-09-28T04:30:00Z'));
    expect(todayIn(clock, 'America/New_York')).toBe('2026-09-28');
    expect(todayIn(clock, 'America/Chicago')).toBe('2026-09-27');
  });
});
