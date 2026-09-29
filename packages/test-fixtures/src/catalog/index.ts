/**
 * Synthetic catalog fixtures for the readiness engine, the catalog publish job, and the
 * recompute job (docs/qa/fixture-plan.md section 7, FX-CAT-*). One entry per rule shape
 * the engine handles, written in the catalog conventions
 * (packages/requirements-catalog/src/conventions.ts):
 *
 *   TEST-05-LICENSE      expiration with lead days (on_hire_and_expiration, 90/60/30/0)
 *   TEST-19-MEETINGS     periodic, calendar period (one per calendar month)
 *   TEST-05-PRIV         periodic since last completion, driven by a bounded tenant parameter
 *   TEST-05-PROCEDURES   one-time document (cadence: null)
 *   TEST-19-BUDGET       board-approval-backed, re-approved every 12 months
 *   TEST-05-DEA          expiration, "Not applicable" allowed
 *   FL-TEST-LICENSE      a Florida state requirement (labeled "Florida requirement")
 *
 * Every id starts with TEST- (or FL-TEST-): these are not catalog content and never
 * describe a real HRSA or Florida rule. Raw objects, parsed by CatalogEntrySchema in the
 * consumer, so this package has no dependency on the catalog package.
 */

const verifiedRef = (key: string, locator: string) => ({
  key,
  locator,
  url: `https://example.test/sources/${key.toLowerCase()}`,
  verifiedOn: '2026-09-01',
  verifiedBy: 'synthetic fixture',
});

const base = {
  layer: 'requirement',
  appliesTo: { awardTypes: ['section330', 'lookalike'] },
  notApplicable: { allowed: false },
  parameters: {},
  severity: 'high',
  effective: { from: '2018-08-20', to: null },
  supersedes: [],
  status: 'verified',
} as const;

export const FX_CAT_ENTRIES = {
  license: {
    ...base,
    id: 'TEST-05-LICENSE',
    chapter: 5,
    title: 'Synthetic: license is current',
    statement: 'Synthetic fixture: a practitioner license is current.',
    sources: [verifiedRef('CM', 'Synthetic chapter 5 locator')],
    appliesTo: { awardTypes: ['section330', 'lookalike'], staffTypes: ['LIP'] },
    evidence: ['license_primary_source_verification'],
    cadence: { trigger: 'on_hire_and_expiration', renewalMonths: null, leadDays: [90, 60, 30, 0] },
    severity: 'critical',
  },
  meetings: {
    ...base,
    id: 'TEST-19-MEETINGS',
    chapter: 19,
    title: 'Synthetic: board meets every calendar month',
    statement: 'Synthetic fixture: at least one board meeting in each calendar month.',
    sources: [verifiedRef('CM', 'Synthetic chapter 19 locator')],
    evidence: ['board_meeting_minutes'],
    cadence: { trigger: 'periodic', renewalMonths: 1, leadDays: [14, 7] },
    parameters: { cadenceBasis: 'calendar_period' },
  },
  privileges: {
    ...base,
    id: 'TEST-05-PRIV',
    chapter: 5,
    title: 'Synthetic: renew privileges on the set interval',
    statement: 'Synthetic fixture: privileges are renewed on the interval the center sets.',
    sources: [verifiedRef('CM', 'Synthetic chapter 5 locator')],
    appliesTo: { awardTypes: ['section330', 'lookalike'], staffTypes: ['LIP', 'OLCP'] },
    evidence: ['privileges_granted_record'],
    cadence: { trigger: 'periodic', renewalMonths: null, leadDays: [60, 30, 0] },
    parameters: {
      cadenceBasis: 'since_last_completion',
      approval: { approvalTypeId: 'cp.privileges.grant', requiredCapacity: 'designated' },
      tenantParameters: {
        reprivilegingIntervalMonths: {
          type: 'integer',
          unit: 'month',
          min: 1,
          max: 24,
          default: 24,
          drives: 'cadence.renewalMonths',
          guidance: 'Synthetic guidance: the interval in your procedures.',
        },
      },
    },
  },
  procedures: {
    ...base,
    id: 'TEST-05-PROCEDURES',
    chapter: 5,
    title: 'Synthetic: credentialing procedures exist',
    statement: 'Synthetic fixture: written credentialing and privileging procedures exist.',
    sources: [verifiedRef('CM', 'Synthetic chapter 5 locator')],
    evidence: ['cp_procedures'],
    cadence: null,
    severity: 'medium',
  },
  budget: {
    ...base,
    id: 'TEST-19-BUDGET',
    chapter: 19,
    title: 'Synthetic: board approves the annual budget',
    statement: 'Synthetic fixture: the board approves the budget every year.',
    sources: [verifiedRef('CM', 'Synthetic chapter 19 locator')],
    evidence: ['board_meeting_minutes'],
    cadence: { trigger: 'periodic', renewalMonths: 12, leadDays: [60, 30] },
    parameters: {
      cadenceBasis: 'since_last_completion',
      approval: { approvalTypeId: 'budget.annual', requiredCapacity: 'board' },
    },
  },
  dea: {
    ...base,
    id: 'TEST-05-DEA',
    chapter: 5,
    title: 'Synthetic: DEA registration is current',
    statement: 'Synthetic fixture: a DEA registration is current where the practitioner prescribes.',
    sources: [verifiedRef('CM', 'Synthetic chapter 5 locator')],
    appliesTo: { awardTypes: ['section330', 'lookalike'], staffTypes: ['LIP'] },
    notApplicable: {
      allowed: true,
      reason: 'The practitioner does not prescribe controlled substances.',
    },
    evidence: ['dea_registration_verification'],
    cadence: { trigger: 'on_expiration', renewalMonths: null, leadDays: [60, 30, 0] },
  },
  floridaLicense: {
    ...base,
    id: 'FL-TEST-LICENSE',
    chapter: null,
    layer: 'state_requirement',
    title: 'Synthetic: Florida license is active',
    statement: 'Synthetic fixture: a Florida license is active.',
    sources: [verifiedRef('FL-456', 'Synthetic chapter 456 locator')],
    appliesTo: { awardTypes: ['section330', 'lookalike'], jurisdiction: 'florida' },
    evidence: ['license_primary_source_verification'],
    cadence: { trigger: 'on_expiration', renewalMonths: null, leadDays: [30, 0] },
  },
} as const;

export type FxCatKey = keyof typeof FX_CAT_ENTRIES;

/** A verified source register for the fixtures (synthetic URLs). */
export const FX_CAT_REGISTER = {
  sources: ['CM', 'FL-456'].map((key) => ({
    key,
    title: `Synthetic ${key}`,
    url: `https://example.test/sources/${key.toLowerCase()}`,
    locator: null,
    version: 'synthetic-1',
    verifiedOn: '2026-09-01',
    verifiedBy: 'synthetic fixture',
    jurisdiction: key.startsWith('FL-') ? 'florida' : 'federal',
    status: 'verified',
  })),
};

/** The fixtures as compiler input ({ file, data } per entry, plus the register). */
export function fxCatSources(
  entries: readonly Record<string, unknown>[] = Object.values(FX_CAT_ENTRIES),
): { entries: { file: string; data: unknown }[]; register: unknown } {
  return {
    register: FX_CAT_REGISTER,
    entries: entries.map((e) => ({ file: `entries/${String(e.id)}.yaml`, data: e })),
  };
}

/**
 * FX-CAT-CHANGE: version 2 retires TEST-05-PROCEDURES and changes TEST-19-BUDGET's
 * cadence (12 to 24 months). Used with FX-CAT-SNAPSHOT: a snapshot taken under v1 keeps
 * v1 and its original statuses.
 */
export function fxCatV2(): Record<string, unknown>[] {
  const all = Object.values(FX_CAT_ENTRIES) as Record<string, unknown>[];
  return all.map((e) => {
    if (e.id === 'TEST-05-PROCEDURES') {
      return { ...e, status: 'retired', effective: { from: '2018-08-20', to: '2026-12-31' } };
    }
    if (e.id === 'TEST-19-BUDGET') {
      return { ...e, cadence: { trigger: 'periodic', renewalMonths: 24, leadDays: [60, 30] } };
    }
    return e;
  });
}
