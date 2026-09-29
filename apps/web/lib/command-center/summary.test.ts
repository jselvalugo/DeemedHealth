import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '@deemed/dates';
import type { RecordView } from '@deemed/domain';
import {
  type Instance,
  dueWithin,
  lastChecked,
  monthGrid,
  monthItems,
  priorities,
  readiness,
  readinessBrief,
  readinessBySite,
  toInstance,
  topPriorities,
} from './summary';

const d = parseCalendarDate;
const TODAY = d('2026-09-29');
const S1 = 'd0000001-0002-4000-8000-000000000001';
const S2 = 'd0000001-0002-4000-8000-000000000002';

let n = 0;
function inst(over: Partial<Instance>): Instance {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    requirementId: `REQ-${String(n).padStart(2, '0')}`,
    subjectType: 'organization',
    subjectId: null,
    siteId: null,
    ownerPersonId: null,
    status: 'met',
    nextDueOn: null,
    statusComputedAt: null,
    ...over,
  };
}

describe('toInstance', () => {
  const row = (fields: RecordView['fields'], archivedAt: string | null = null): RecordView => ({
    id: 'a',
    rowVersion: 1,
    archivedAt,
    fields,
  });

  it('reads a requirement instance row', () => {
    expect(
      toInstance(
        row({
          requirementId: 'CM-20-BOARD-SIZE',
          subjectType: 'site',
          subjectId: S1,
          siteId: S1,
          ownerPersonId: null,
          status: 'due_soon',
          nextDueOn: '2026-10-31',
          statusComputedAt: '2026-09-28T09:00:00.000Z',
        }),
      ),
    ).toMatchObject({ status: 'due_soon', siteId: S1, nextDueOn: '2026-10-31' });
  });

  it('skips archived rows, unknown statuses, and ignores malformed dates', () => {
    expect(toInstance(row({ requirementId: 'X', status: 'met' }, '2026-01-01T00:00:00Z'))).toBe(
      null,
    );
    expect(toInstance(row({ requirementId: 'X', status: 'approved' }))).toBe(null);
    expect(toInstance(row({ status: 'met' }))).toBe(null);
    expect(toInstance(row({ requirementId: 'X', status: 'met', nextDueOn: '2026-02-30' }))).toEqual(
      expect.objectContaining({ nextDueOn: null }),
    );
  });
});

describe('readiness score', () => {
  it('is met over applicable, excludes not applicable, and rounds down', () => {
    const r = readiness([
      inst({ status: 'met' }),
      inst({ status: 'met' }),
      inst({ status: 'overdue' }),
      inst({ status: 'not_applicable' }),
    ]);
    expect(r).toMatchObject({ total: 4, applicable: 3, met: 2, percent: 66 });
    expect(r.counts).toEqual({ overdue: 1, missing: 0, due_soon: 0, met: 2, not_applicable: 1 });
  });

  it('has no percent when nothing applies', () => {
    expect(readiness([]).percent).toBe(null);
    expect(readiness([inst({ status: 'not_applicable' })]).percent).toBe(null);
  });

  it('shows 100 only when everything applicable is met', () => {
    const many = [...Array.from({ length: 199 }, () => inst({ status: 'met' }))];
    expect(readiness([...many, inst({ status: 'missing' })]).percent).toBe(99);
    expect(readiness(many).percent).toBe(100);
  });
});

describe('readiness by site', () => {
  it('puts organization-wide first, then the site needing the most attention', () => {
    const rows = readinessBySite([
      inst({ siteId: S1, status: 'met' }),
      inst({ siteId: S2, status: 'overdue' }),
      inst({ siteId: null, status: 'met' }),
      inst({ siteId: S1, status: 'missing' }),
    ]);
    expect(rows.map((r) => r.siteId)).toEqual([null, S2, S1]);
    expect(rows[2]!.readiness).toMatchObject({ applicable: 2, met: 1, percent: 50 });
  });
});

describe("today's priorities", () => {
  const overdueOld = inst({ status: 'overdue', nextDueOn: d('2026-08-01') });
  const overdueNew = inst({ status: 'overdue', nextDueOn: d('2026-09-28') });
  const week = inst({ status: 'due_soon', nextDueOn: d('2026-10-06') });
  const later = inst({ status: 'due_soon', nextDueOn: d('2026-10-07') });
  const missing = inst({ status: 'missing' });
  const met = inst({ status: 'met', nextDueOn: d('2026-09-30') });
  const na = inst({ status: 'not_applicable' });
  const groups = priorities([later, met, missing, overdueNew, na, week, overdueOld], TODAY);

  it('groups by status and orders by due date', () => {
    expect(groups.overdue.map((p) => p.instance)).toEqual([overdueOld, overdueNew]);
    expect(groups.overdue[0]!.daysUntilDue).toBe(-59);
    expect(groups.this_week.map((p) => p.instance)).toEqual([week]);
    expect(groups.this_week[0]!.daysUntilDue).toBe(7);
    expect(groups.coming_up.map((p) => p.instance)).toEqual([later]);
    expect(groups.missing.map((p) => p.instance)).toEqual([missing]);
  });

  it('never lists met or not-applicable instances', () => {
    const all = Object.values(groups)
      .flat()
      .map((p) => p.instance);
    expect(all).not.toContain(met);
    expect(all).not.toContain(na);
  });

  it('keeps group order in the short list', () => {
    expect(topPriorities(groups, 4).map((p) => p.group)).toEqual([
      'overdue',
      'overdue',
      'this_week',
      'missing',
    ]);
  });

  it('counts days across a leap day', () => {
    const leap = priorities(
      [inst({ status: 'due_soon', nextDueOn: d('2028-03-01') })],
      d('2028-02-28'),
    );
    expect(leap.this_week[0]!.daysUntilDue).toBe(2);
  });
});

describe('due within', () => {
  it('includes both ends and excludes not applicable', () => {
    const a = inst({ status: 'met', nextDueOn: TODAY });
    const b = inst({ status: 'due_soon', nextDueOn: d('2026-10-29') });
    const c = inst({ status: 'due_soon', nextDueOn: d('2026-10-30') });
    const e = inst({ status: 'not_applicable', nextDueOn: d('2026-10-01') });
    const f = inst({ status: 'overdue', nextDueOn: d('2026-09-28') });
    expect(dueWithin([c, b, a, e, f], TODAY, 30).map((p) => p.instance)).toEqual([a, b]);
  });
});

describe('month grid', () => {
  it('starts on Sunday and covers the whole month', () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    const weeks = monthGrid(d('2026-09-15'), TODAY, []);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]![0]!.date).toBe('2026-08-30');
    expect(weeks[0]![2]).toMatchObject({ date: '2026-09-01', inMonth: true });
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(weeks[4]![6]!.date).toBe('2026-10-03');
    expect(
      weeks
        .flat()
        .filter((day) => day.isToday)
        .map((day) => day.date),
    ).toEqual(['2026-09-29']);
  });

  it('handles February in a leap year and a month starting on Sunday', () => {
    const feb = monthGrid(d('2032-02-01'), TODAY, []);
    expect(feb[0]![0]!.date).toBe('2032-02-01');
    expect(feb.flat().filter((day) => day.inMonth)).toHaveLength(29);
  });

  it('places items on their due date and skips not applicable', () => {
    const a = inst({ status: 'due_soon', nextDueOn: d('2026-10-31') });
    const na = inst({ status: 'not_applicable', nextDueOn: d('2026-10-31') });
    const days = monthGrid(d('2026-10-01'), TODAY, [a, na]).flat();
    expect(days.find((day) => day.date === '2026-10-31')!.items).toEqual([a]);
  });

  it('lists the month with days counted from today', () => {
    const a = inst({ status: 'overdue', nextDueOn: d('2026-09-01') });
    const b = inst({ status: 'due_soon', nextDueOn: d('2026-10-01') });
    const items = monthItems(d('2026-09-10'), TODAY, [b, a]);
    expect(items.map((p) => [p.instance, p.daysUntilDue])).toEqual([[a, -28]]);
  });
});

describe('readiness brief', () => {
  it('summarizes score, upcoming, attention, and the last check', () => {
    const items = [
      inst({ status: 'met', statusComputedAt: '2026-09-27T09:00:00.000Z' }),
      inst({ status: 'met', nextDueOn: d('2026-10-10') }),
      inst({ status: 'due_soon', nextDueOn: d('2026-10-05'), siteId: S1 }),
      inst({ status: 'overdue', nextDueOn: d('2026-09-01'), siteId: S2 }),
      inst({ status: 'missing', statusComputedAt: '2026-09-28T09:00:00.000Z' }),
    ];
    const brief = readinessBrief(items, TODAY);
    expect(brief.readiness).toMatchObject({ met: 2, applicable: 5, percent: 40 });
    expect(brief.dueNext30.map((p) => p.instance.nextDueOn)).toEqual(['2026-10-05']);
    expect(brief.attention.map((s) => s.siteId)).toEqual([null, S2]);
    expect(brief.lastChecked).toBe('2026-09-28T09:00:00.000Z');
    expect(lastChecked([])).toBe(null);
  });
});
