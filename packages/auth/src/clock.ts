/**
 * Time source for the auth rules (idle and absolute timeouts, step-up window, TOTP,
 * token expiry). Services receive a Clock; tests pass a FakeClock and move it forward.
 * Sign-in throttling is the exception: it runs on the database clock (migration 0006),
 * so a caller cannot move its own lock.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to. For tests and deterministic replays. */
export class FakeClock implements Clock {
  private ms: number;

  constructor(start: Date | string) {
    this.ms = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(by: { ms?: number; seconds?: number; minutes?: number; hours?: number; days?: number }) {
    this.ms +=
      (by.ms ?? 0) +
      (by.seconds ?? 0) * 1000 +
      (by.minutes ?? 0) * 60_000 +
      (by.hours ?? 0) * 3_600_000 +
      (by.days ?? 0) * 86_400_000;
    return this;
  }

  set(at: Date | string) {
    this.ms = new Date(at).getTime();
    return this;
  }
}
