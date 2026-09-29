import { readdirSync, readFileSync } from 'node:fs';
import { CatalogEntrySchema } from '@deemed/requirements-catalog';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { evaluate } from './evaluate.js';
import {
  CENTRAL,
  EASTERN,
  LIP_AT_SITE,
  ORG_WIDE,
  approval,
  expiring,
  fact,
  fxEntry,
  input,
  naMark,
} from './fixtures.test-utils.js';
import { INTERNAL_LABEL } from './messages.js';

const codes = (r: ReturnType<typeof evaluate>) => r.reasons.map((x) => x.code);

describe('expiration with lead days (TEST-05-LICENSE, 90/60/30/0)', () => {
  const license = fxEntry('license');
  const run = (asOf: string, facts = [expiring('2027-06-30')], tz = EASTERN) =>
    evaluate(input(license, asOf, { facts, timeZone: tz }));

  it('is met outside the lead window, with the date and the citation', () => {
    const r = run('2027-01-01T17:00:00Z');
    expect(r).toMatchObject({
      status: 'met',
      nextDueOn: '2027-06-30',
      rule: 'expiration',
      leadTier: null,
      requirementId: 'TEST-05-LICENSE',
      catalogVersion: '2026.1.0',
      internalOnly: true,
    });
    expect(r.citation).toMatchObject({ authority: 'hrsa', chapter: 5, entryStatus: 'verified' });
    expect(r.citation.sources[0]).toMatchObject({ key: 'CM', verifiedOn: '2026-09-01' });
    expect(r.summary).toContain('not an HRSA determination');
  });

  it('turns due_soon on each lead day and names the tier', () => {
    // The 90-day reminder date is Apr 1: the item turns due_soon that day.
    expect(run('2027-03-31T16:00:00Z')).toMatchObject({
      status: 'met',
      leadTier: null,
      daysUntilDue: 91,
    });
    expect(run('2027-04-01T16:00:00Z')).toMatchObject({
      status: 'due_soon',
      leadTier: 90,
      daysUntilDue: 90,
    });
    expect(run('2027-04-02T16:00:00Z')).toMatchObject({ status: 'due_soon', leadTier: 90 });
    expect(run('2027-05-01T16:00:00Z')).toMatchObject({ status: 'due_soon', leadTier: 60 });
    expect(run('2027-05-31T16:00:00Z')).toMatchObject({ status: 'due_soon', leadTier: 30 });
    const today = run('2027-06-30T16:00:00Z');
    expect(today).toMatchObject({ status: 'due_soon', leadTier: 0, daysUntilDue: 0 });
    expect(codes(today)).toEqual(['expires_today']);
  });

  it('expires at local midnight: Eastern first, Central one hour later (FX-DATE-TZ-E, FX-DATE-TZ-C)', () => {
    // 2027-07-01T04:30Z is 00:30 EDT on July 1 but 23:30 CDT on June 30.
    const eastern = run('2027-07-01T04:30:00Z', undefined, EASTERN);
    const central = run('2027-07-01T04:30:00Z', undefined, CENTRAL);
    expect(eastern).toMatchObject({ status: 'overdue', asOfDate: '2027-07-01' });
    expect(codes(eastern)).toContain('expired');
    expect(central).toMatchObject({ status: 'due_soon', asOfDate: '2027-06-30', leadTier: 0 });
    // Central lapses at 05:00Z.
    expect(run('2027-07-01T04:59:59Z', undefined, CENTRAL).status).toBe('due_soon');
    expect(run('2027-07-01T05:00:00Z', undefined, CENTRAL).status).toBe('overdue');
  });

  it('has no off-by-one day on DST switch days in either zone (FX-DATE-DST)', () => {
    // DST starts 2027-03-14: an expiry that day lapses at 00:00 EDT Mar 15 = 04:00Z.
    const f = [expiring('2027-03-14')];
    expect(run('2027-03-15T03:59:59Z', f, EASTERN).status).toBe('due_soon');
    expect(run('2027-03-15T04:00:00Z', f, EASTERN).status).toBe('overdue');
    // DST ends 2027-11-07: an expiry that day lapses at 00:00 CST Nov 8 = 06:00Z.
    const g = [expiring('2027-11-07')];
    expect(run('2027-11-08T05:59:59Z', g, CENTRAL).status).toBe('due_soon');
    expect(run('2027-11-08T06:00:00Z', g, CENTRAL).status).toBe('overdue');
  });

  it('handles a leap-day expiration and its lead days (FX-DATE-FEB29)', () => {
    const f = [expiring('2028-02-29')];
    // 90 days before 2028-02-29 is 2027-12-01.
    expect(run('2027-11-30T15:00:00Z', f)).toMatchObject({ status: 'met', daysUntilDue: 91 });
    expect(run('2027-12-01T15:00:00Z', f)).toMatchObject({ status: 'due_soon', leadTier: 90 });
    // 30 days before a leap day is Jan 30.
    expect(run('2028-01-30T15:00:00Z', f)).toMatchObject({ leadTier: 30, daysUntilDue: 30 });
    expect(run('2028-02-29T15:00:00Z', f)).toMatchObject({ status: 'due_soon', leadTier: 0 });
    expect(run('2028-03-01T15:00:00Z', f).status).toBe('overdue');
  });

  it('is missing with no evidence, and a renewal supersedes the old credential', () => {
    expect(run('2027-01-01T17:00:00Z', [])).toMatchObject({ status: 'missing', nextDueOn: null });
    const renewed = run('2027-07-15T17:00:00Z', [
      expiring('2027-06-30'),
      expiring('2029-06-30', '2027-06-20'),
    ]);
    expect(renewed).toMatchObject({ status: 'met', nextDueOn: '2029-06-30' });
  });

  it('ignores evidence recorded after the as-of instant, and retracted evidence', () => {
    const late = expiring('2029-06-30', '2027-08-01');
    expect(run('2027-07-15T17:00:00Z', [expiring('2027-06-30'), late]).status).toBe('overdue');
    const retracted = fact('expiration', '2025-01-02', {
      expiresOn: '2029-06-30',
      retractedAt: '2027-01-10T00:00:00Z',
    });
    expect(run('2027-01-09T17:00:00Z', [retracted]).status).toBe('met');
    expect(run('2027-01-11T17:00:00Z', [retracted]).status).toBe('missing');
  });
});

describe('periodic, calendar period (TEST-19-MEETINGS, monthly, lead 14/7)', () => {
  const meetings = fxEntry('meetings');
  const run = (asOf: string, dates: string[]) =>
    evaluate(
      input(meetings, asOf, {
        applicability: ORG_WIDE,
        facts: dates.map((d) => fact('completion', d)),
      }),
    );

  it('is met when this month has a meeting; next due is the end of next month', () => {
    const r = run('2026-09-29T15:00:00Z', ['2026-09-10']);
    expect(r).toMatchObject({ status: 'met', nextDueOn: '2026-10-31', intervalMonths: 1 });
    expect(codes(r)).toEqual(['period_satisfied', 'due_on']);
  });

  it('is pending (met, then due_soon inside the lead days) when last month was covered', () => {
    expect(run('2026-09-10T15:00:00Z', ['2026-08-20'])).toMatchObject({
      status: 'met',
      nextDueOn: '2026-09-30',
    });
    expect(run('2026-09-20T15:00:00Z', ['2026-08-20'])).toMatchObject({
      status: 'due_soon',
      leadTier: 14,
    });
  });

  it('is overdue when a whole calendar month was missed', () => {
    const r = run('2026-09-05T15:00:00Z', ['2026-07-20']);
    expect(r.status).toBe('overdue');
    expect(r.reasons[0]).toMatchObject({
      code: 'period_missed',
      params: { periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    });
  });

  it('uses real month ends, including leap February (FX-DATE-MONTHEND)', () => {
    expect(run('2028-02-20T15:00:00Z', ['2028-01-15'])).toMatchObject({ nextDueOn: '2028-02-29' });
    expect(run('2027-02-20T15:00:00Z', ['2027-01-15'])).toMatchObject({ nextDueOn: '2027-02-28' });
  });

  it('is missing with no meetings at all', () => {
    expect(run('2026-09-05T15:00:00Z', []).status).toBe('missing');
  });
});

describe('periodic since last completion, bounded tenant parameter (TEST-05-PRIV)', () => {
  const priv = fxEntry('privileges');
  const run = (asOf: string, facts: ReturnType<typeof approval>[], tenantParameters = {}) =>
    evaluate(input(priv, asOf, { facts, tenantParameters }));

  it('uses the catalog default (24 months) until the tenant sets a value', () => {
    const r = run('2026-09-29T15:00:00Z', [
      approval('2025-01-31', 'designated', 'cp.privileges.grant'),
    ]);
    expect(r).toMatchObject({ status: 'met', nextDueOn: '2027-01-31', intervalMonths: 24 });
  });

  it('uses the tenant value within bounds, from the last completion, with month-end clamping', () => {
    const r = run(
      '2026-09-29T15:00:00Z',
      [approval('2025-01-31', 'designated', 'cp.privileges.grant')],
      { reprivilegingIntervalMonths: 12 },
    );
    expect(r).toMatchObject({ status: 'overdue', nextDueOn: '2026-01-31', intervalMonths: 12 });
    const clamp = run(
      '2026-09-29T15:00:00Z',
      [approval('2026-08-31', 'designated', 'cp.privileges.grant')],
      { reprivilegingIntervalMonths: 6 },
    );
    expect(clamp).toMatchObject({ status: 'met', nextDueOn: '2027-02-28' });
  });

  it('fails closed on an out-of-bounds or unset parameter (not_assessed, never a guess)', () => {
    const out = run('2026-09-29T15:00:00Z', [approval('2025-01-31', 'designated')], {
      reprivilegingIntervalMonths: 30,
    });
    expect(out.status).toBe('not_assessed');
    expect(out.reasons[0]).toMatchObject({
      code: 'tenant_parameter_out_of_bounds',
      params: { parameter: 'reprivilegingIntervalMonths', min: 1, max: 24, value: 30 },
    });
    const noDefault = fxEntry('privileges', {
      parameters: {
        ...(fxEntry('privileges').parameters as object),
        tenantParameters: {
          reprivilegingIntervalMonths: {
            type: 'integer',
            unit: 'month',
            min: 1,
            max: 24,
            default: null,
            drives: 'cadence.renewalMonths',
            guidance: 'Synthetic: set at onboarding.',
          },
        },
      },
    });
    const unset = evaluate(
      input(noDefault, '2026-09-29T15:00:00Z', { facts: [approval('2025-01-31', 'designated')] }),
    );
    expect(unset.status).toBe('not_assessed');
    expect(codes(unset)).toEqual(['tenant_parameter_unset']);
  });

  it('counts only approvals in a capacity that satisfies "designated", of the right type', () => {
    const staff = run('2026-09-29T15:00:00Z', [approval('2025-01-31', 'staff')]);
    expect(staff.status).toBe('missing');
    expect(codes(staff)).toEqual(['approval_capacity_insufficient', 'no_evidence']);
    const board = run('2026-09-29T15:00:00Z', [approval('2025-01-31', 'board')]);
    expect(board.status).toBe('met');
    const otherType = run('2026-09-29T15:00:00Z', [
      approval('2025-01-31', 'board', 'budget.annual'),
    ]);
    expect(otherType.status).toBe('missing');
  });
});

describe('one-time document (TEST-05-PROCEDURES)', () => {
  const procedures = fxEntry('procedures');
  it('is missing without a document and met with one dated on or before the as-of date', () => {
    const at = '2026-09-29T15:00:00Z';
    expect(evaluate(input(procedures, at, { applicability: ORG_WIDE })).status).toBe('missing');
    expect(
      evaluate(
        input(procedures, at, { applicability: ORG_WIDE, facts: [fact('document', '2026-03-01')] }),
      ),
    ).toMatchObject({ status: 'met', nextDueOn: null, rule: 'one_time' });
    // A document dated tomorrow in the site calendar does not count yet.
    expect(
      evaluate(
        input(procedures, at, {
          applicability: ORG_WIDE,
          facts: [fact('document', '2026-09-30', { recordedAt: '2026-09-29T12:00:00Z' })],
        }),
      ).status,
    ).toBe('missing');
  });

  it('on_change re-opens when the underlying fact changes after the evidence', () => {
    const onChange = fxEntry('procedures', {
      cadence: { trigger: 'on_change', renewalMonths: null, leadDays: [] },
    });
    const at = '2026-09-29T15:00:00Z';
    const base = { applicability: ORG_WIDE };
    expect(
      evaluate(input(onChange, at, { ...base, facts: [fact('document', '2026-01-10')] })),
    ).toMatchObject({
      status: 'met',
      rule: 'on_change',
    });
    const changed = evaluate(
      input(onChange, at, {
        ...base,
        facts: [fact('document', '2026-01-10'), fact('change', '2026-05-01')],
      }),
    );
    expect(changed.status).toBe('missing');
    expect(codes(changed)).toEqual(['changed_since_evidence']);
  });
});

describe('board-approval-backed (TEST-19-BUDGET, board, every 12 months)', () => {
  const budget = fxEntry('budget');
  const run = (facts: ReturnType<typeof approval>[], asOf = '2026-09-29T15:00:00Z') =>
    evaluate(input(budget, asOf, { applicability: ORG_WIDE, facts }));

  it('is satisfied only by a board approval', () => {
    expect(run([approval('2025-10-01', 'board', 'budget.annual')])).toMatchObject({
      status: 'due_soon',
      nextDueOn: '2026-10-01',
      leadTier: 30,
    });
    expect(run([approval('2025-10-01', 'committee_ratified', 'budget.annual')]).status).toBe(
      'missing',
    );
    expect(run([approval('2025-10-01', 'designated', 'budget.annual')]).status).toBe('missing');
  });

  it('does not count a rejection, and says so', () => {
    const r = run([approval('2025-10-01', 'board', 'budget.annual', 'rejected')]);
    expect(r.status).toBe('missing');
    expect(codes(r)).toEqual(['approval_rejected', 'no_evidence']);
  });

  it('does not count ordinary documents (a document is not an approval)', () => {
    expect(
      evaluate(
        input(budget, '2026-09-29T15:00:00Z', {
          applicability: ORG_WIDE,
          facts: [fact('document', '2026-01-01')],
        }),
      ).status,
    ).toBe('missing');
  });
});

describe('not applicable (TEST-05-DEA allows it; TEST-05-LICENSE does not)', () => {
  it('is not_applicable when a person marked it and the catalog allows it', () => {
    const r = evaluate(
      input(fxEntry('dea'), '2026-09-29T15:00:00Z', { notApplicable: naMark('2026-09-01') }),
    );
    expect(r.status).toBe('not_applicable');
    expect(r.reasons[0]).toMatchObject({
      code: 'marked_not_applicable',
      params: { decidedOn: '2026-09-01' },
    });
    // The free-text reason is never copied into the result.
    expect(JSON.stringify(r)).not.toContain('prescribe');
  });

  it('keeps and flags an N/A mark the catalog no longer allows: evaluated normally, never better than at risk', () => {
    const r = evaluate(
      input(fxEntry('license'), '2026-09-29T15:00:00Z', {
        notApplicable: naMark('2026-09-01'),
        facts: [expiring('2030-01-01')],
      }),
    );
    // The license is current (would be met), but a person's mark needs review.
    expect(r.status).toBe('due_soon');
    expect(r.notApplicableSuperseded).toBe(true);
    expect(codes(r)[0]).toBe('na_superseded_needs_review');
    const lapsed = evaluate(
      input(fxEntry('license'), '2026-09-29T15:00:00Z', {
        notApplicable: naMark('2026-09-01'),
        facts: [expiring('2026-01-01')],
      }),
    );
    expect(lapsed).toMatchObject({ status: 'overdue', notApplicableSuperseded: true });
    // A not-assessed cause never touches the mark: no flag.
    const retired = fxEntry('dea', {
      status: 'retired',
      effective: { from: '2018-08-20', to: '2026-01-01' },
    });
    const na = evaluate(
      input(retired, '2026-09-29T15:00:00Z', { notApplicable: naMark('2025-09-01') }),
    );
    expect(na).toMatchObject({ status: 'not_assessed', notApplicableSuperseded: false });
  });

  it('does not apply a mark recorded after the as-of instant', () => {
    const r = evaluate(
      input(fxEntry('dea'), '2026-08-15T15:00:00Z', { notApplicable: naMark('2026-09-01') }),
    );
    expect(r.status).toBe('missing');
  });
});

describe('gates before the rule', () => {
  it('fails closed on a draft entry in the production channel, and badges drafts elsewhere', () => {
    const draft = fxEntry('license', { status: 'draft' });
    const prod = evaluate(
      input(draft, '2026-09-29T15:00:00Z', {
        channel: 'production',
        facts: [expiring('2030-01-01')],
      }),
    );
    expect(prod.status).toBe('not_assessed');
    expect(codes(prod)).toEqual(['entry_not_verified', 'draft_entry']);
    const nonProd = evaluate(
      input(draft, '2026-09-29T15:00:00Z', { facts: [expiring('2030-01-01')] }),
    );
    expect(nonProd.status).toBe('met');
    expect(codes(nonProd)).toContain('draft_entry');
  });

  it('does not assess retired, not-yet-effective, or out-of-scope requirements', () => {
    const retired = fxEntry('license', {
      status: 'retired',
      effective: { from: '2018-08-20', to: '2026-01-01' },
    });
    expect(codes(evaluate(input(retired, '2026-09-29T15:00:00Z')))).toEqual(['entry_retired']);
    const future = fxEntry('license', { effective: { from: '2027-01-01', to: null } });
    expect(evaluate(input(future, '2026-09-29T15:00:00Z')).reasons[0]?.code).toBe('not_effective');
    // Effective through a date inclusive, in the site's calendar.
    const ended = fxEntry('license', { effective: { from: '2018-08-20', to: '2026-09-29' } });
    expect(
      evaluate(input(ended, '2026-09-30T03:30:00Z', { facts: [expiring('2030-01-01')] })).status,
    ).toBe('met');
    expect(evaluate(input(ended, '2026-09-30T04:30:00Z')).status).toBe('not_assessed');
    // LIP-only entry, organization subject; section330-only entry, Look-Alike.
    expect(
      evaluate(input(fxEntry('license'), '2026-09-29T15:00:00Z', { applicability: ORG_WIDE }))
        .reasons[0],
    ).toMatchObject({
      code: 'outside_applicability',
      params: { dimension: 'staffTypes' },
    });
    const only330 = fxEntry('license', {
      appliesTo: { awardTypes: ['section330'], staffTypes: ['LIP'] },
    });
    expect(
      evaluate(
        input(only330, '2026-09-29T15:00:00Z', {
          applicability: { ...LIP_AT_SITE, awardType: 'lookalike' },
        }),
      ).reasons[0]?.params,
    ).toEqual({ dimension: 'awardTypes' });
    const mhc = fxEntry('procedures', {
      appliesTo: { awardTypes: ['section330'], subPrograms: ['MHC'], siteTypes: ['mobile'] },
    });
    expect(evaluate(input(mhc, '2026-09-29T15:00:00Z')).reasons[0]?.params).toEqual({
      dimension: 'subPrograms',
    });
    const mobile = fxEntry('procedures', {
      appliesTo: { awardTypes: ['section330'], siteTypes: ['mobile'] },
    });
    expect(evaluate(input(mobile, '2026-09-29T15:00:00Z')).reasons[0]?.params).toEqual({
      dimension: 'siteTypes',
    });
  });
});

describe('labels (roadmap section 2 rule 5; ADR-0003 rule 6)', () => {
  it('labels a Florida entry "Florida requirement", never HRSA', () => {
    const r = evaluate(
      input(fxEntry('floridaLicense'), '2026-09-29T15:00:00Z', { facts: [expiring('2030-01-01')] }),
    );
    expect(r.citation.authority).toBe('florida');
    expect(r.summary).toContain(INTERNAL_LABEL.florida);
    expect(r.summary).toMatch(/^Met\. /);
  });

  it('carries the internal-readiness label in every summary', () => {
    for (const key of [
      'license',
      'meetings',
      'privileges',
      'procedures',
      'budget',
      'dea',
    ] as const) {
      const r = evaluate(input(fxEntry(key), '2026-09-29T15:00:00Z'));
      expect(r.summary, key).toContain('not an HRSA determination');
      expect(r.internalOnly).toBe(true);
    }
  });
});

describe('the draft catalog entries (packages/requirements-catalog/entries)', () => {
  const dir = new URL('../../requirements-catalog/entries/', import.meta.url);
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => CatalogEntrySchema.parse(parseYaml(readFileSync(new URL(f, dir), 'utf8'))));

  it('resolves a rule for every entry and never assesses a draft in production', () => {
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const e of entries) {
      const nonProd = evaluate(
        input(e, '2026-09-29T15:00:00Z', {
          applicability: { ...LIP_AT_SITE, staffTypes: ['LIP', 'OLCP'] },
        }),
      );
      expect(codes(nonProd), e.id).not.toContain('rule_unresolved');
      expect(codes(nonProd), e.id).toContain('draft_entry');
      const prod = evaluate(input(e, '2026-09-29T15:00:00Z', { channel: 'production' }));
      expect(prod.status, e.id).toBe('not_assessed');
    }
  });
});
