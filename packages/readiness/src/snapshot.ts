/**
 * Readiness snapshots (ADR-0003 rule 4): the evaluated state of a tenant on one date,
 * pinned to the catalog version it was computed under. Snapshots feed trend lines and
 * "as of" reports and are never recomputed silently: a new catalog version produces new
 * snapshots, and old ones keep their version.
 *
 * The score is always a count with its denominator ("12 of 15 met"), never a bare
 * percentage, and always internal readiness (roadmap section 2 rule 5). Severity weights
 * are not in the catalog yet, so the score is unweighted.
 */
import type { CalendarDate } from '@deemed/dates';
import {
  ENGINE_VERSION,
  READINESS_STATUSES,
  SCORED_STATUSES,
  type Authority,
  type CatalogChannel,
  type ReadinessStatus,
} from './types.js';

export interface SnapshotItem {
  instanceId: string;
  requirementId: string;
  siteId: string | null;
  chapter: number | null;
  authority: Authority;
  status: ReadinessStatus;
  nextDueOn: CalendarDate | null;
  /** Reason codes only (the messages are rebuilt from codes and params). */
  reasonCodes: readonly string[];
}

export interface ScoreLine {
  met: number;
  /** Instances that count: met, due_soon, overdue, missing. */
  denominator: number;
  counts: Readonly<Record<ReadinessStatus, number>>;
}

export interface ReadinessSnapshotBody {
  catalogVersion: string;
  channel: CatalogChannel;
  engineVersion: string;
  asOfDate: CalendarDate;
  label: 'internal_readiness_not_hrsa_determination';
  total: ScoreLine;
  byChapter: Readonly<Record<string, ScoreLine>>;
  bySite: Readonly<Record<string, ScoreLine>>;
  byAuthority: Readonly<Record<string, ScoreLine>>;
  items: readonly SnapshotItem[];
}

function emptyCounts(): Record<ReadinessStatus, number> {
  return Object.fromEntries(READINESS_STATUSES.map((s) => [s, 0])) as Record<
    ReadinessStatus,
    number
  >;
}

function line(items: readonly SnapshotItem[]): ScoreLine {
  const counts = emptyCounts();
  for (const i of items) counts[i.status] += 1;
  return {
    met: counts.met,
    denominator: SCORED_STATUSES.reduce((n, s) => n + counts[s], 0),
    counts,
  };
}

function groupBy(
  items: readonly SnapshotItem[],
  key: (i: SnapshotItem) => string,
): Record<string, ScoreLine> {
  const groups = new Map<string, SnapshotItem[]>();
  for (const i of items) {
    const k = key(i);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return Object.fromEntries(
    [...groups.keys()].sort().map((k) => [k, line(groups.get(k) as SnapshotItem[])]),
  );
}

export function buildSnapshot(input: {
  catalogVersion: string;
  channel: CatalogChannel;
  asOfDate: CalendarDate;
  items: readonly SnapshotItem[];
}): ReadinessSnapshotBody {
  const items = [...input.items]
    .map((i) => ({ ...i, reasonCodes: [...i.reasonCodes] }))
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  return {
    catalogVersion: input.catalogVersion,
    channel: input.channel,
    engineVersion: ENGINE_VERSION,
    asOfDate: input.asOfDate,
    label: 'internal_readiness_not_hrsa_determination',
    total: line(items),
    byChapter: groupBy(items, (i) => (i.chapter === null ? 'none' : String(i.chapter))),
    bySite: groupBy(items, (i) => i.siteId ?? 'organization'),
    byAuthority: groupBy(items, (i) => i.authority),
    items,
  };
}

/** "12 of 15 met": the only way a score is rendered. */
export function formatScore(score: ScoreLine): string {
  return `${score.met} of ${score.denominator} met (internal readiness, not an HRSA determination)`;
}
