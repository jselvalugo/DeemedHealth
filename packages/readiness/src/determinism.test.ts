/**
 * Property-based tests (test strategy G1 readiness row): the engine is a pure function of
 * its inputs. Same inputs, same result; fact order, cloning, and facts recorded after the
 * as-of instant never matter; the input is never mutated; the result is plain data.
 */
import {
  addDays,
  instantFromEpochMilliseconds,
  parseCalendarDate,
  type CalendarDate,
  type Instant,
} from '@deemed/dates';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate.js';
import { CENTRAL, EASTERN, LIP_AT_SITE, ORG_WIDE, fxEntry } from './fixtures.test-utils.js';
import {
  READINESS_STATUSES,
  type ApplicabilityContext,
  type EvaluationInput,
  type ReadinessFact,
  type ReadinessStatus,
} from './types.js';

const EPOCH = parseCalendarDate('2024-01-01');
const T0 = Date.UTC(2024, 0, 1);
const T1 = Date.UTC(2031, 0, 1);

const day = fc.integer({ min: 0, max: 2_500 }).map((n) => addDays(EPOCH, n));
const instant = fc.integer({ min: T0, max: T1 }).map((ms) => instantFromEpochMilliseconds(ms));

const factArb: fc.Arbitrary<ReadinessFact> = fc
  .record({
    id: fc.uuid(),
    kind: fc.constantFrom('document', 'completion', 'expiration', 'approval', 'change'),
    effectiveOn: day,
    expiresOn: fc.option(day, { nil: null }),
    recordedAt: instant,
    retractedAt: fc.option(instant, { nil: null }),
    capacity: fc.constantFrom('board', 'committee_ratified', 'designated', 'staff'),
    decision: fc.constantFrom('approved', 'rejected'),
    approvalTypeId: fc.constantFrom(null, 'budget.annual', 'cp.privileges.grant', 'other.type'),
    evidenceTypeId: fc.constantFrom(
      null,
      'cp_procedures',
      'board_meeting_minutes',
      'license_primary_source_verification',
      'dea_registration_verification',
      'other_type',
    ),
  })
  .map((r) => ({
    id: r.id,
    kind: r.kind,
    evidenceTypeId: r.evidenceTypeId,
    effectiveOn: r.effectiveOn,
    expiresOn: r.kind === 'expiration' ? r.expiresOn : null,
    recordedAt: r.recordedAt,
    retractedAt: r.retractedAt,
    approval:
      r.kind === 'approval'
        ? { capacity: r.capacity, decision: r.decision, approvalTypeId: r.approvalTypeId }
        : null,
  }));

const KEYS = [
  'license',
  'meetings',
  'privileges',
  'procedures',
  'budget',
  'dea',
  'floridaLicense',
] as const;
const CONTEXTS: ApplicabilityContext[] = [
  LIP_AT_SITE,
  ORG_WIDE,
  { ...LIP_AT_SITE, awardType: 'lookalike', staffTypes: ['OLCP'] },
];

const inputArb: fc.Arbitrary<EvaluationInput> = fc
  .record({
    key: fc.constantFrom(...KEYS),
    status: fc.constantFrom('verified', 'draft'),
    channel: fc.constantFrom('production', 'non_production'),
    context: fc.constantFrom(...CONTEXTS),
    param: fc.option(fc.integer({ min: -3, max: 40 }), { nil: undefined }),
    facts: fc.array(factArb, { maxLength: 8 }),
    na: fc.option(fc.record({ decidedOn: day, recordedAt: instant }), { nil: null }),
    asOf: instant,
    tz: fc.constantFrom(EASTERN, CENTRAL),
  })
  .map((r) => ({
    entry: fxEntry(r.key, { status: r.status }),
    catalogVersion: '2026.1.0',
    channel: r.channel,
    applicability: r.context,
    tenantParameters: r.param === undefined ? {} : { reprivilegingIntervalMonths: r.param },
    facts: r.facts,
    notApplicable: r.na ? { ...r.na, hasReason: true } : null,
    asOf: r.asOf,
    timeZone: r.tz,
  }));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const RANK: Record<ReadinessStatus, number> = {
  met: 4,
  due_soon: 3,
  overdue: 2,
  missing: 1,
  not_applicable: 0,
  not_assessed: 0,
};

const RUNS = { numRuns: 400 };

describe('readiness engine properties', () => {
  it('gives the same result for the same input, including a deep clone', () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        expect(evaluate(x)).toEqual(evaluate(x));
        expect(evaluate(clone(x))).toEqual(evaluate(x));
      }),
      RUNS,
    );
  });

  it('does not depend on the order facts arrive in', () => {
    fc.assert(
      fc.property(inputArb, fc.infiniteStream(fc.nat()), (x, randoms) => {
        const shuffled = [...x.facts];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (randoms.next().value as number) % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j] as ReadinessFact, shuffled[i] as ReadinessFact];
        }
        expect(evaluate({ ...x, facts: shuffled })).toEqual(evaluate(x));
      }),
      RUNS,
    );
  });

  it('never mutates its input and returns plain JSON data', () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        const before = JSON.stringify(x);
        const r = evaluate(deepFreeze(x));
        expect(JSON.stringify(x)).toBe(before);
        expect(clone(r)).toEqual(r);
      }),
      RUNS,
    );
  });

  it('ignores facts recorded after the as-of instant (as-of reports are reproducible)', () => {
    fc.assert(
      fc.property(inputArb, fc.array(factArb, { minLength: 1, maxLength: 4 }), (x, extra) => {
        const later = extra.map((f, i) => ({
          ...f,
          id: `later-${i}`,
          recordedAt: (x.asOf + 1 + i) as Instant,
        }));
        expect(evaluate({ ...x, facts: [...x.facts, ...later] })).toEqual(evaluate(x));
      }),
      RUNS,
    );
  });

  it('keeps its invariants: vocabulary, reasons, label, N/A only when allowed, drafts closed in production', () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        const r = evaluate(x);
        expect(READINESS_STATUSES).toContain(r.status);
        expect(r.reasons.length).toBeGreaterThan(0);
        expect(r.summary).toMatch(/not (an HRSA determination|a determination by HRSA)/);
        expect(r.internalOnly).toBe(true);
        expect(r.requirementId).toBe(x.entry.id);
        expect(r.catalogVersion).toBe(x.catalogVersion);
        if (r.status === 'not_applicable') {
          expect(x.entry.notApplicable.allowed).toBe(true);
          expect(x.notApplicable && x.notApplicable.recordedAt <= x.asOf).toBe(true);
        }
        if (x.channel === 'production' && x.entry.status !== 'verified') {
          expect(r.status).toBe('not_assessed');
        }
        if (r.status === 'met' && r.rule === 'expiration') {
          expect(r.nextDueOn).not.toBeNull();
        }
      }),
      RUNS,
    );
  });

  it('never gets worse when a later-expiring credential is added (expiration rule)', () => {
    fc.assert(
      fc.property(inputArb, day, (x, extraExpiry) => {
        const entry = fxEntry('license');
        const base = { ...x, entry, channel: 'non_production' as const, notApplicable: null };
        const known = x.facts
          .filter((f) => f.kind === 'expiration' && f.expiresOn)
          .map((f) => f.expiresOn as CalendarDate);
        const latest = [extraExpiry, ...known].sort().at(-1) as CalendarDate;
        const renewal: ReadinessFact = {
          id: 'renewal',
          kind: 'expiration',
          evidenceTypeId: 'license_primary_source_verification',
          effectiveOn: EPOCH,
          expiresOn: addDays(latest, 1),
          recordedAt: instantFromEpochMilliseconds(T0),
          retractedAt: null,
          approval: null,
        };
        const before = evaluate(base);
        const after = evaluate({ ...base, facts: [...base.facts, renewal] });
        expect(RANK[after.status]).toBeGreaterThanOrEqual(RANK[before.status]);
      }),
      RUNS,
    );
  });
});
