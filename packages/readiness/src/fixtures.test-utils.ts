import { parseCalendarDate, parseInstant, type TimeZone } from '@deemed/dates';
import { CatalogEntrySchema, type CatalogEntry } from '@deemed/requirements-catalog';
import { FX_CAT_ENTRIES, type FxCatKey } from '@deemed/test-fixtures/catalog';
import type {
  ApplicabilityContext,
  EvaluationInput,
  NotApplicableMark,
  ReadinessFact,
} from './types.js';

export const EASTERN: TimeZone = 'America/New_York';
export const CENTRAL: TimeZone = 'America/Chicago';

export function fxEntry(key: FxCatKey, over: Record<string, unknown> = {}): CatalogEntry {
  return CatalogEntrySchema.parse({ ...FX_CAT_ENTRIES[key], ...over });
}

export const LIP_AT_SITE: ApplicabilityContext = {
  awardType: 'section330',
  subPrograms: ['CHC'],
  siteType: 'service_delivery',
  staffTypes: ['LIP'],
};

export const ORG_WIDE: ApplicabilityContext = {
  awardType: 'section330',
  subPrograms: ['CHC'],
  siteType: null,
  staffTypes: null,
};

/** The FX-CAT entries' evidence types, by fact kind (tests pass another to test F5). */
const DEFAULT_EVIDENCE: Partial<Record<ReadinessFact['kind'], string>> = {
  document: 'cp_procedures',
  completion: 'board_meeting_minutes',
  expiration: 'license_primary_source_verification',
};

let seq = 0;
export function fact(
  kind: ReadinessFact['kind'],
  effectiveOn: string,
  over: Partial<Omit<ReadinessFact, 'effectiveOn' | 'recordedAt' | 'retractedAt' | 'expiresOn'>> & {
    recordedAt?: string;
    retractedAt?: string | null;
    expiresOn?: string | null;
  } = {},
): ReadinessFact {
  seq += 1;
  const { recordedAt, retractedAt, expiresOn, ...rest } = over;
  return {
    id: rest.id ?? `fact-${String(seq).padStart(4, '0')}`,
    kind,
    evidenceTypeId:
      rest.evidenceTypeId !== undefined ? rest.evidenceTypeId : (DEFAULT_EVIDENCE[kind] ?? null),
    effectiveOn: parseCalendarDate(effectiveOn),
    recordedAt: parseInstant(recordedAt ?? `${effectiveOn}T12:00:00Z`),
    retractedAt: retractedAt ? parseInstant(retractedAt) : null,
    expiresOn: expiresOn ? parseCalendarDate(expiresOn) : null,
    approval: rest.approval ?? null,
  };
}

export const approval = (
  effectiveOn: string,
  capacity: NonNullable<ReadinessFact['approval']>['capacity'],
  approvalTypeId: string | null = null,
  decision: 'approved' | 'rejected' = 'approved',
): ReadinessFact =>
  fact('approval', effectiveOn, { approval: { capacity, decision, approvalTypeId } });

export const expiring = (expiresOn: string, recordedOn = '2025-01-02'): ReadinessFact =>
  fact('expiration', recordedOn, { expiresOn });

export function naMark(decidedOn: string, recordedAt?: string): NotApplicableMark {
  return {
    decidedOn: parseCalendarDate(decidedOn),
    recordedAt: parseInstant(recordedAt ?? `${decidedOn}T15:00:00Z`),
    hasReason: true,
  };
}

export function input(
  entry: CatalogEntry,
  asOf: string,
  over: Partial<Omit<EvaluationInput, 'entry' | 'asOf'>> = {},
): EvaluationInput {
  return {
    entry,
    catalogVersion: '2026.1.0',
    channel: 'non_production',
    applicability: LIP_AT_SITE,
    tenantParameters: {},
    facts: [],
    notApplicable: null,
    timeZone: EASTERN,
    ...over,
    asOf: parseInstant(asOf),
  };
}
