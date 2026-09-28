import { FakeClock } from '@deemed/auth';
import { describe, expect, it } from 'vitest';
import { USER_LIMIT_DEFAULTS, UserLimiter } from './user-limits.js';

const ORG = '0f000000-0000-4000-8000-000000000001';

describe('per-user limits (security review M2)', () => {
  it('defaults to 10 reveals, 5 exports, and 5 import dry runs a minute', () => {
    expect(USER_LIMIT_DEFAULTS).toMatchObject({
      revealPerMinute: 10,
      exportPerMinute: 5,
      importPerMinute: 5,
    });
  });

  it('counts per organization, user, and group, and resets after a minute', () => {
    const clock = new FakeClock(new Date('2026-09-28T12:00:00Z'));
    const limiter = new UserLimiter({ exportPerMinute: 2 }, clock);
    expect(limiter.hit(ORG, 'u1', 'export').allowed).toBe(true);
    expect(limiter.hit(ORG, 'u1', 'export').allowed).toBe(true);
    expect(limiter.hit(ORG, 'u1', 'export')).toMatchObject({ allowed: false, count: 3, limit: 2 });
    // Another user, another group, another tenant: their own counters.
    expect(limiter.hit(ORG, 'u2', 'export').allowed).toBe(true);
    expect(limiter.hit(ORG, 'u1', 'import').allowed).toBe(true);
    expect(limiter.hit('0f000000-0000-4000-8000-000000000002', 'u1', 'export').allowed).toBe(true);
    clock.advance({ seconds: 61 });
    expect(limiter.hit(ORG, 'u1', 'export').allowed).toBe(true);
  });

  it('raises the reveal-volume alert once at the threshold, then on every refusal', () => {
    const clock = new FakeClock(new Date('2026-09-28T12:00:00Z'));
    const limiter = new UserLimiter({ revealPerMinute: 3, revealAlertAt: 2 }, clock);
    const alerts = [1, 2, 3, 4, 5].map(() => limiter.hit(ORG, 'u1', 'reveal'));
    expect(alerts.map((a) => a.alert)).toEqual([false, true, false, true, true]);
    expect(alerts.map((a) => a.allowed)).toEqual([true, true, true, false, false]);
    // Exports never raise the reveal alert.
    expect(new UserLimiter({ exportPerMinute: 1 }, clock).hit(ORG, 'u1', 'export').alert).toBe(
      false,
    );
  });
});
