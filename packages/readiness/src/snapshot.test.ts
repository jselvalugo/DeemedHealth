/**
 * Snapshot tests: a fixed matrix of fixtures (one per rule shape, both Florida time
 * zones, month ends, the 2028 leap day) evaluated and stored under __snapshots__, so any
 * change in engine semantics shows up in review. Plus readiness snapshots pinned to their
 * catalog version (FX-CAT-SNAPSHOT, FX-CAT-CHANGE).
 */
import { parseCalendarDate } from '@deemed/dates';
import { CatalogEntrySchema } from '@deemed/requirements-catalog';
import { fxCatV2 } from '@deemed/test-fixtures/catalog';
import { describe, expect, it } from 'vitest';
import { authorityOf, evaluate } from './evaluate.js';
import {
  CENTRAL,
  ORG_WIDE,
  approval,
  expiring,
  fact,
  fxEntry,
  input,
  naMark,
} from './fixtures.test-utils.js';
import { buildSnapshot, formatScore, type SnapshotItem } from './snapshot.js';
import type { EvaluationInput, EvaluationResult } from './types.js';

const AS_OF = [
  '2026-09-29T15:00:00Z',
  '2027-06-30T16:00:00Z',
  '2027-07-01T04:30:00Z',
  '2028-02-29T15:00:00Z',
];

function matrix(): Record<string, Omit<EvaluationInput, 'asOf'>> {
  // The matrix is evaluated at every AS_OF instant, so each case keeps everything but asOf.
  const base = (i: EvaluationInput): Omit<EvaluationInput, 'asOf'> => i;
  const at = AS_OF[0] as string;
  return {
    'license, expires 2027-06-30, Eastern': base(
      input(fxEntry('license'), at, { facts: [expiring('2027-06-30')] }),
    ),
    'license, expires 2027-06-30, Central': base(
      input(fxEntry('license'), at, { facts: [expiring('2027-06-30')], timeZone: CENTRAL }),
    ),
    'license, expires on the leap day': base(
      input(fxEntry('license'), at, { facts: [expiring('2028-02-29')] }),
    ),
    'license, nothing on file': base(input(fxEntry('license'), at)),
    'meetings, monthly, last on 2026-09-10': base(
      input(fxEntry('meetings'), at, {
        applicability: ORG_WIDE,
        facts: [fact('completion', '2026-09-10')],
      }),
    ),
    'privileges, designated approval 2025-08-31, tenant 12 months': base(
      input(fxEntry('privileges'), at, {
        facts: [approval('2025-08-31', 'designated', 'cp.privileges.grant')],
        tenantParameters: { reprivilegingIntervalMonths: 12 },
      }),
    ),
    'procedures, document 2026-03-01': base(
      input(fxEntry('procedures'), at, {
        applicability: ORG_WIDE,
        facts: [fact('document', '2026-03-01')],
      }),
    ),
    'budget, board approval 2025-10-01': base(
      input(fxEntry('budget'), at, {
        applicability: ORG_WIDE,
        facts: [approval('2025-10-01', 'board', 'budget.annual')],
      }),
    ),
    'dea, marked not applicable': base(
      input(fxEntry('dea'), at, { notApplicable: naMark('2026-09-01') }),
    ),
    'florida license, expires 2027-06-30': base(
      input(fxEntry('floridaLicense'), at, { facts: [expiring('2027-06-30')] }),
    ),
    'license draft, production channel': base(
      input(fxEntry('license', { status: 'draft' }), at, {
        channel: 'production',
        facts: [expiring('2027-06-30')],
      }),
    ),
  };
}

// Deterministic fact ids for the snapshot file.
function stable(r: EvaluationResult) {
  return {
    status: r.status,
    asOfDate: r.asOfDate,
    nextDueOn: r.nextDueOn,
    leadTier: r.leadTier,
    summary: r.summary,
  };
}

describe('evaluation snapshots', () => {
  for (const [name, i] of Object.entries(matrix())) {
    it(name, () => {
      const rows = AS_OF.map((asOf) => {
        const r = evaluate({ ...i, asOf: input(i.entry, asOf).asOf });
        return { asOf, ...stable(r) };
      });
      expect(rows).toMatchSnapshot();
    });
  }
});

function items(
  results: { id: string; siteId: string | null; r: EvaluationResult }[],
): SnapshotItem[] {
  return results.map(({ id, siteId, r }) => ({
    instanceId: id,
    requirementId: r.requirementId,
    siteId,
    chapter: r.citation.chapter,
    authority: r.citation.authority,
    status: r.status,
    nextDueOn: r.nextDueOn,
    reasonCodes: r.reasons.map((x) => x.code),
  }));
}

describe('readiness snapshots', () => {
  const at = '2026-09-29T15:00:00Z';
  const v1 = {
    procedures: fxEntry('procedures'),
    budget: fxEntry('budget'),
    license: fxEntry('license'),
    dea: fxEntry('dea'),
  };
  const facts = {
    procedures: [fact('document', '2026-03-01')],
    budget: [approval('2025-10-01', 'board', 'budget.annual')],
    license: [expiring('2026-09-01')],
  };

  it('summarizes counts with their denominator, by chapter, site, and authority', () => {
    const results = [
      {
        id: 'i-1',
        siteId: null,
        r: evaluate(input(v1.procedures, at, { applicability: ORG_WIDE, facts: facts.procedures })),
      },
      {
        id: 'i-2',
        siteId: null,
        r: evaluate(input(v1.budget, at, { applicability: ORG_WIDE, facts: facts.budget })),
      },
      { id: 'i-3', siteId: 's-1', r: evaluate(input(v1.license, at, { facts: facts.license })) },
      {
        id: 'i-4',
        siteId: 's-1',
        r: evaluate(input(v1.dea, at, { notApplicable: naMark('2026-09-01') })),
      },
    ];
    const snap = buildSnapshot({
      catalogVersion: '2026.1.0',
      channel: 'non_production',
      asOfDate: parseCalendarDate('2026-09-29'),
      items: items(results).reverse(),
    });
    expect(snap.items.map((i) => i.instanceId)).toEqual(['i-1', 'i-2', 'i-3', 'i-4']);
    expect(snap.total).toMatchObject({ met: 1, denominator: 3 });
    expect(snap.total.counts).toMatchObject({ met: 1, due_soon: 1, overdue: 1, not_applicable: 1 });
    expect(formatScore(snap.total, 'hrsa')).toBe(
      '1 of 3 met (HRSA requirements; internal readiness, not an HRSA determination)',
    );
    expect(snap.label).toBe('internal_readiness_not_hrsa_determination');
    expect(snap).toMatchSnapshot();
  });

  it('keeps the catalog version it was computed under; a new version changes new snapshots only (FX-CAT-SNAPSHOT, FX-CAT-CHANGE)', () => {
    const v2 = Object.fromEntries(fxCatV2().map((e) => [e.id, CatalogEntrySchema.parse(e)]));
    const run = (
      version: string,
      procedures: typeof v1.procedures,
      budget: typeof v1.budget,
      asOf: string,
    ) =>
      buildSnapshot({
        catalogVersion: version,
        channel: 'non_production',
        asOfDate: parseCalendarDate(asOf.slice(0, 10)),
        items: items([
          {
            id: 'i-1',
            siteId: null,
            r: evaluate(
              input(procedures, asOf, {
                applicability: ORG_WIDE,
                facts: facts.procedures,
                catalogVersion: version,
              }),
            ),
          },
          {
            id: 'i-2',
            siteId: null,
            r: evaluate(
              input(budget, asOf, {
                applicability: ORG_WIDE,
                facts: facts.budget,
                catalogVersion: version,
              }),
            ),
          },
        ]),
      });
    const before = run('2026.1.0', v1.procedures, v1.budget, '2027-01-15T15:00:00Z');
    const frozen = JSON.stringify(before);
    const after = run(
      '2026.2.0',
      v2['TEST-05-PROCEDURES'] as typeof v1.procedures,
      v2['TEST-19-BUDGET'] as typeof v1.budget,
      '2027-01-15T15:00:00Z',
    );
    // v1: procedures met, budget overdue (12 months from 2025-10-01).
    expect(before.catalogVersion).toBe('2026.1.0');
    expect(before.items.map((i) => i.status)).toEqual(['met', 'overdue']);
    // v2: procedures retired (not assessed), budget every 24 months (met).
    expect(after.catalogVersion).toBe('2026.2.0');
    expect(after.items.map((i) => i.status)).toEqual(['not_assessed', 'met']);
    expect(after.total).toMatchObject({ met: 1, denominator: 1 });
    // The earlier snapshot is unchanged by the new version.
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('labels payer rules as payer rules and keeps them out of the HRSA total', () => {
    const entry = fxEntry('floridaLicense', {
      id: 'CMS-TEST-PAYER-RULE',
      layer: 'payer_rule',
      appliesTo: { ...fxEntry('floridaLicense').appliesTo, jurisdiction: 'federal' },
    });
    expect(authorityOf(entry)).toBe('payer');
    const r = evaluate(input(entry, at, { facts: [expiring('2030-01-01')] }));
    expect(r.citation.authority).toBe('payer');
    expect(r.summary).toContain('not a determination by HRSA, CMS, or the state Medicaid agency');
    const snap = buildSnapshot({
      catalogVersion: '2026.1.0',
      channel: 'non_production',
      asOfDate: parseCalendarDate('2026-09-29'),
      items: items([{ id: 'i-10', siteId: 's-1', r }]),
    });
    expect(snap.total).toMatchObject({ met: 0, denominator: 0 });
    expect(snap.byAuthority.payer).toMatchObject({ denominator: 1 });
  });

  it('groups Florida requirements apart from HRSA ones', () => {
    const r = evaluate(input(fxEntry('floridaLicense'), at, { facts: [expiring('2030-01-01')] }));
    expect(authorityOf(fxEntry('floridaLicense'))).toBe('florida');
    const snap = buildSnapshot({
      catalogVersion: '2026.1.0',
      channel: 'non_production',
      asOfDate: parseCalendarDate('2026-09-29'),
      items: items([{ id: 'i-9', siteId: 's-1', r }]),
    });
    expect(Object.keys(snap.byAuthority)).toEqual(['florida']);
    expect(Object.keys(snap.byChapter)).toEqual(['none']);
    // The total counts HRSA requirements only; Florida has its own line and label (F8).
    expect(snap.total).toMatchObject({ met: 0, denominator: 0 });
    expect(snap.byAuthority.florida).toMatchObject({ met: 1, denominator: 1 });
    expect(formatScore(snap.byAuthority.florida!, 'florida')).toBe(
      '1 of 1 met (Florida requirements; internal readiness, not a determination by HRSA or the State of Florida)',
    );
  });
});
