/**
 * Command Center math: the internal readiness score, today's priorities, the calendar
 * grid, and the readiness brief, all computed from the requirement instances the viewer
 * may read. Pure functions, so the pages and the tests share one definition.
 *
 * Statuses come from the readiness engine (they are derived fields on
 * `requirement_instance`); nothing here recomputes a status from dates. Dates only
 * order items and say how far away they are ("3 days overdue").
 *
 * Score (hrsa-requirements-framework.md §6, roadmap Phase 2 row 6): met ÷ applicable,
 * where applicable excludes "Not applicable". It is always shown with its denominator
 * and as "internal readiness", never as an HRSA determination.
 */
import {
  type CalendarDate,
  addDays,
  compareDates,
  differenceInDays,
  endOfMonth,
  isCalendarDate,
  isoDayOfWeek,
  startOfMonth,
} from '@deemed/dates';
import type { RecordView, RequirementInstanceStatus } from '@deemed/domain';

export const STATUSES = [
  'overdue',
  'missing',
  'due_soon',
  'met',
  'not_applicable',
] as const satisfies readonly RequirementInstanceStatus[];

export type Instance = {
  id: string;
  requirementId: string;
  subjectType: string;
  subjectId: string | null;
  siteId: string | null;
  ownerPersonId: string | null;
  status: RequirementInstanceStatus;
  nextDueOn: CalendarDate | null;
  statusComputedAt: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** A list row as an instance; null when the row is not a readable requirement instance. */
export function toInstance(row: RecordView): Instance | null {
  const f = row.fields;
  const status = (STATUSES as readonly string[]).includes(f.status as string)
    ? (f.status as RequirementInstanceStatus)
    : null;
  const requirementId = str(f.requirementId);
  if (!status || !requirementId || row.archivedAt) return null;
  const due = str(f.nextDueOn);
  return {
    id: row.id,
    requirementId,
    subjectType: str(f.subjectType) ?? 'organization',
    subjectId: str(f.subjectId),
    siteId: str(f.siteId),
    ownerPersonId: str(f.ownerPersonId),
    status,
    nextDueOn: due && isCalendarDate(due) ? due : null,
    statusComputedAt: str(f.statusComputedAt),
  };
}

export type Readiness = {
  total: number;
  /** Everything except "Not applicable": the score's denominator. */
  applicable: number;
  met: number;
  /** Whole percent, rounded down so it never overstates; null with nothing applicable. */
  percent: number | null;
  counts: Record<RequirementInstanceStatus, number>;
};

export function readiness(items: readonly Instance[]): Readiness {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    RequirementInstanceStatus,
    number
  >;
  for (const i of items) counts[i.status] += 1;
  const applicable = items.length - counts.not_applicable;
  return {
    total: items.length,
    applicable,
    met: counts.met,
    percent: applicable > 0 ? Math.floor((counts.met * 100) / applicable) : null,
    counts,
  };
}

export type SiteReadiness = { siteId: string | null; readiness: Readiness };

/**
 * Readiness per site, organization-wide instances (no site) first, then the sites that
 * need the most attention: most overdue, then most missing, then the lowest score.
 */
export function readinessBySite(items: readonly Instance[]): SiteReadiness[] {
  const groups = new Map<string | null, Instance[]>();
  for (const i of items) groups.set(i.siteId, [...(groups.get(i.siteId) ?? []), i]);
  return [...groups.entries()]
    .map(([siteId, group]) => ({ siteId, readiness: readiness(group) }))
    .sort((a, b) => {
      if ((a.siteId === null) !== (b.siteId === null)) return a.siteId === null ? -1 : 1;
      const ra = a.readiness;
      const rb = b.readiness;
      return (
        rb.counts.overdue - ra.counts.overdue ||
        rb.counts.missing - ra.counts.missing ||
        (ra.percent ?? 101) - (rb.percent ?? 101) ||
        (a.siteId ?? '').localeCompare(b.siteId ?? '')
      );
    });
}

export const PRIORITY_GROUPS = ['overdue', 'this_week', 'missing', 'coming_up'] as const;
export type PriorityGroup = (typeof PRIORITY_GROUPS)[number];

export type PriorityItem = {
  instance: Instance;
  /** Due date − today in days (negative when overdue); null without a due date. */
  daysUntilDue: number | null;
};

/** Days ahead that count as "this week" on Today's priorities. */
export const THIS_WEEK_DAYS = 7;

function byDueDate(a: PriorityItem, b: PriorityItem): number {
  const da = a.instance.nextDueOn;
  const db = b.instance.nextDueOn;
  if (da && db) {
    const c = compareDates(da, db);
    if (c !== 0) return c;
  } else if (da !== db) {
    return da ? -1 : 1;
  }
  return a.instance.requirementId.localeCompare(b.instance.requirementId);
}

/**
 * Today's priorities: everything that is not met, grouped by what to do first.
 * Overdue, then due within a week, then missing evidence, then the rest of "due soon".
 * Met and not-applicable instances are not priorities.
 */
export function priorities(
  items: readonly Instance[],
  today: CalendarDate,
): Record<PriorityGroup, PriorityItem[]> {
  const out: Record<PriorityGroup, PriorityItem[]> = {
    overdue: [],
    this_week: [],
    missing: [],
    coming_up: [],
  };
  for (const instance of items) {
    const daysUntilDue = instance.nextDueOn ? differenceInDays(instance.nextDueOn, today) : null;
    const item = { instance, daysUntilDue };
    switch (instance.status) {
      case 'overdue':
        out.overdue.push(item);
        break;
      case 'missing':
        out.missing.push(item);
        break;
      case 'due_soon':
        if (daysUntilDue !== null && daysUntilDue <= THIS_WEEK_DAYS) out.this_week.push(item);
        else out.coming_up.push(item);
        break;
      default:
        break;
    }
  }
  for (const g of PRIORITY_GROUPS) out[g].sort(byDueDate);
  return out;
}

/** The first `limit` priorities in group order (the Overview's short list). */
export function topPriorities(
  groups: Record<PriorityGroup, PriorityItem[]>,
  limit: number,
): (PriorityItem & { group: PriorityGroup })[] {
  return PRIORITY_GROUPS.flatMap((group) => groups[group].map((i) => ({ ...i, group }))).slice(
    0,
    limit,
  );
}

/** Instances with a due date from `from` through `from + days`, soonest first. */
export function dueWithin(
  items: readonly Instance[],
  from: CalendarDate,
  days: number,
): PriorityItem[] {
  const until = addDays(from, days);
  return items
    .filter(
      (i) =>
        i.status !== 'not_applicable' &&
        i.nextDueOn !== null &&
        compareDates(i.nextDueOn, from) >= 0 &&
        compareDates(i.nextDueOn, until) <= 0,
    )
    .map((instance) => ({
      instance,
      daysUntilDue: differenceInDays(instance.nextDueOn as CalendarDate, from),
    }))
    .sort(byDueDate);
}

export type CalendarDay = {
  date: CalendarDate;
  inMonth: boolean;
  isToday: boolean;
  items: Instance[];
};

/**
 * The month containing `month` as weeks of seven days, Sunday first (US calendars), with
 * each day's due instances. Not-applicable instances have nothing due.
 */
export function monthGrid(
  month: CalendarDate,
  today: CalendarDate,
  items: readonly Instance[],
): CalendarDay[][] {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const byDate = new Map<string, Instance[]>();
  for (const i of items) {
    if (!i.nextDueOn || i.status === 'not_applicable') continue;
    byDate.set(i.nextDueOn, [...(byDate.get(i.nextDueOn) ?? []), i]);
  }
  // isoDayOfWeek: Monday 1 … Sunday 7, so Sunday-first offset is dow mod 7.
  let day = addDays(first, -(isoDayOfWeek(first) % 7));
  const weeks: CalendarDay[][] = [];
  while (compareDates(day, last) <= 0) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({
        date: day,
        inMonth: compareDates(day, first) >= 0 && compareDates(day, last) <= 0,
        isToday: day === today,
        items: [...(byDate.get(day) ?? [])].sort((a, b) =>
          a.requirementId.localeCompare(b.requirementId),
        ),
      });
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Due instances in the month containing `month`, soonest first (the calendar's list). */
export function monthItems(
  month: CalendarDate,
  today: CalendarDate,
  items: readonly Instance[],
): PriorityItem[] {
  const first = startOfMonth(month);
  return dueWithin(items, first, differenceInDays(endOfMonth(month), first)).map((p) => ({
    ...p,
    daysUntilDue: differenceInDays(p.instance.nextDueOn as CalendarDate, today),
  }));
}

export type Brief = {
  asOf: CalendarDate;
  readiness: Readiness;
  /** Due in the next 30 days (from today, inclusive) and not yet met. */
  dueNext30: PriorityItem[];
  /** Sites (null = organization-wide) with overdue or missing items, worst first. */
  attention: SiteReadiness[];
  /** The latest time the engine checked any of these statuses. */
  lastChecked: string | null;
};

/** Days ahead the brief looks for upcoming due dates (framework §6 "At risk"). */
export const BRIEF_HORIZON_DAYS = 30;

/**
 * The readiness brief: a plain, computed summary of where the health center stands.
 * It is not written by AI; AI-drafted briefs come with the Deemed Assistant (Phase 6).
 */
export function readinessBrief(items: readonly Instance[], today: CalendarDate): Brief {
  return {
    asOf: today,
    readiness: readiness(items),
    dueNext30: dueWithin(items, today, BRIEF_HORIZON_DAYS).filter(
      (p) => p.instance.status !== 'met',
    ),
    attention: readinessBySite(items).filter(
      (s) => s.readiness.counts.overdue + s.readiness.counts.missing > 0,
    ),
    lastChecked: lastChecked(items),
  };
}

/** The most recent `statusComputedAt` (ISO instants compare as strings). */
export function lastChecked(items: readonly Instance[]): string | null {
  let latest: string | null = null;
  for (const i of items) {
    if (i.statusComputedAt && (latest === null || i.statusComputedAt > latest)) {
      latest = i.statusComputedAt;
    }
  }
  return latest;
}
