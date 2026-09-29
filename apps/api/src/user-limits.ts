/**
 * Per-user limits on sensitive record routes (security review M2): reveals, exports, and
 * import dry runs. Keyed by organization and user account, never by client address, so
 * a user cannot spread requests over several networks and a shared office network does
 * not throttle its neighbours. The window runs on the API's injected clock.
 *
 * Reveal volume raises a structured alert (a `security_alert` log line with ids and
 * counts only, never values) when a user reaches `revealAlertAt` in a window, and on
 * every refused reveal, for the S8 log alerting to route to `security-privacy-officer`.
 *
 * Counters live in this process's memory, like the global rate limit: a shared store is
 * required before production runs more than one API task (phase-1 plan S9).
 */
import type { Clock } from '@deemed/auth';

export const USER_LIMIT_GROUPS = ['reveal', 'export', 'import'] as const;
export type UserLimitGroup = (typeof USER_LIMIT_GROUPS)[number];

export interface UserLimitOptions {
  revealPerMinute?: number;
  exportPerMinute?: number;
  importPerMinute?: number;
  /** Reveals in one minute that raise the volume alert (before the limit refuses any). */
  revealAlertAt?: number;
}

export const USER_LIMIT_DEFAULTS: Required<UserLimitOptions> = {
  revealPerMinute: 10,
  exportPerMinute: 5,
  importPerMinute: 5,
  revealAlertAt: 8,
};

const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;

export interface UserLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** A reveal-volume alert should be raised for this request. */
  alert: boolean;
}

export class UserLimiter {
  private readonly limits: Required<UserLimitOptions>;
  private readonly windows = new Map<string, { start: number; count: number; alerted: boolean }>();

  constructor(
    options: UserLimitOptions,
    private readonly clock: Clock,
  ) {
    this.limits = { ...USER_LIMIT_DEFAULTS, ...options };
  }

  private limitFor(group: UserLimitGroup): number {
    if (group === 'reveal') return this.limits.revealPerMinute;
    if (group === 'export') return this.limits.exportPerMinute;
    return this.limits.importPerMinute;
  }

  /** Counts one request by this user in this group. */
  hit(organizationId: string, userAccountId: string, group: UserLimitGroup): UserLimitResult {
    const now = this.clock.now().getTime();
    const key = `${organizationId}:${userAccountId}:${group}`;
    let w = this.windows.get(key);
    if (!w || now - w.start >= WINDOW_MS || now < w.start) {
      w = { start: now, count: 0, alerted: false };
      this.windows.set(key, w);
      if (this.windows.size > MAX_KEYS) this.prune(now);
    }
    w.count += 1;
    const limit = this.limitFor(group);
    const allowed = w.count <= limit;
    let alert = false;
    if (group === 'reveal') {
      if (!allowed) alert = true;
      else if (w.count >= this.limits.revealAlertAt && !w.alerted) {
        w.alerted = true;
        alert = true;
      }
    }
    return { allowed, count: w.count, limit, alert };
  }

  private prune(now: number): void {
    for (const [key, w] of this.windows) if (now - w.start >= WINDOW_MS) this.windows.delete(key);
  }
}
