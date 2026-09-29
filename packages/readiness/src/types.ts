import type { CalendarDate, Instant, TimeZone } from '@deemed/dates';
import type { CatalogEntry } from '@deemed/requirements-catalog';

/** Bumped whenever evaluation semantics change; stored with every snapshot. */
export const ENGINE_VERSION = '1.0.0';

/**
 * Requirement instance statuses (stored in `requirement_instance.status`). They map to the
 * framework's readiness vocabulary (hrsa-requirements-framework.md section 6):
 *
 *   met             Met
 *   due_soon        At risk: inside the catalog's lead-day window, or due today
 *   overdue         Not met: expired, or the due date or calendar period has passed
 *   missing         Not met: no qualifying evidence at all
 *   not_applicable  Not applicable: a person marked it, with a reason, where the catalog allows
 *   not_assessed    Not assessed: the engine cannot evaluate it (entry not verified in
 *                   production, retired, not yet effective, outside its applicability, or
 *                   a tenant parameter that must be set is missing)
 *
 * Every status is an internal readiness status, never an HRSA determination.
 */
export const READINESS_STATUSES = [
  'met',
  'due_soon',
  'overdue',
  'missing',
  'not_applicable',
  'not_assessed',
] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/** Statuses that count in a readiness score's denominator. */
export const SCORED_STATUSES: readonly ReadinessStatus[] = [
  'met',
  'due_soon',
  'overdue',
  'missing',
];

export type CatalogChannel = 'production' | 'non_production';

/**
 * Who recorded an approval, in the capacity terms of approval-authority.md section 4.1.
 * `committee_ratified`: a board committee acted and the full board ratified it.
 */
export type ApprovalCapacity = 'board' | 'committee_ratified' | 'designated' | 'staff';

export type FactKind = 'document' | 'completion' | 'expiration' | 'approval' | 'change';

/**
 * One piece of evidence the engine reads, already reduced to dates (no file content,
 * no personal data). Recorded by a person or an integration, never by the AI assistant.
 */
export interface ReadinessFact {
  id: string;
  kind: FactKind;
  /** Date of the document, completion, approval, or change (site calendar date). */
  effectiveOn: CalendarDate;
  /** `expiration` facts: valid through this date (end of day in the site's zone). */
  expiresOn?: CalendarDate | null;
  /** When the fact was recorded (UTC). Facts recorded after the as-of instant are ignored. */
  recordedAt: Instant;
  /** When the fact was retracted, if it was (ignored from then on). */
  retractedAt?: Instant | null;
  /** `approval` facts. */
  approval?: {
    capacity: ApprovalCapacity;
    decision: 'approved' | 'rejected';
    approvalTypeId?: string | null;
  } | null;
}

/** A person's "Not applicable" decision on an instance (reason is required, never shown here). */
export interface NotApplicableMark {
  decidedOn: CalendarDate;
  recordedAt: Instant;
  /** The reason text exists (it is free text and stays in the tenant record, not in results). */
  hasReason: boolean;
}

/** What the instance's subject is, for `appliesTo` (ADR-0003 rule 5). */
export interface ApplicabilityContext {
  awardType: 'section330' | 'lookalike';
  subPrograms: readonly string[];
  /** Site type of the instance's site; null for an organization-wide instance. */
  siteType: string | null;
  /** Staff types of a person subject; null when the subject is not a person. */
  staffTypes: readonly string[] | null;
  /**
   * Dimensions the platform holds no data for yet (e.g. staffTypes until provider
   * profiles exist). The engine does not check them: the instance's existence is the
   * applicability decision for those dimensions.
   */
  unknownDimensions?: readonly ('siteTypes' | 'staffTypes')[];
}

export interface EvaluationInput {
  entry: CatalogEntry;
  catalogVersion: string;
  channel: CatalogChannel;
  applicability: ApplicabilityContext;
  /** Tenant-chosen values by parameter name (bounded by the entry's tenantParameters). */
  tenantParameters: Readonly<Record<string, number>>;
  facts: readonly ReadinessFact[];
  notApplicable: NotApplicableMark | null;
  /** The evaluation instant ("now" for live status, a past instant for as-of reports). */
  asOf: Instant;
  /** The site's zone (or the organization's for an organization-wide instance). */
  timeZone: TimeZone;
}

export type ReasonCode =
  | 'no_catalog_release'
  | 'not_in_catalog'
  | 'entry_not_verified'
  | 'entry_retired'
  | 'not_effective'
  | 'outside_applicability'
  | 'marked_not_applicable'
  | 'not_applicable_not_allowed'
  | 'tenant_parameter_unset'
  | 'tenant_parameter_out_of_bounds'
  | 'rule_unresolved'
  | 'no_evidence'
  | 'approval_capacity_insufficient'
  | 'approval_rejected'
  | 'valid_through'
  | 'expires_today'
  | 'expired'
  | 'due_on'
  | 'due_today'
  | 'past_due'
  | 'lead_tier'
  | 'period_satisfied'
  | 'period_pending'
  | 'period_missed'
  | 'evidence_on_file'
  | 'changed_since_evidence'
  | 'draft_entry';

export type ReasonParams = Readonly<Record<string, string | number | null>>;

export interface Reason {
  code: ReasonCode;
  /** i18n key for the UI (EN/ES in packages/i18n). */
  messageKey: `readiness.reason.${ReasonCode}`;
  params: ReasonParams;
  /** Plain-English rendering, for logs, exports, and tests. */
  message: string;
}

/** "HRSA requirement" vs "Florida requirement" vs "Best practice" (ADR-0003 rule 6). */
export type Authority = 'hrsa' | 'florida' | 'best_practice';

export interface Citation {
  requirementId: string;
  title: string;
  authority: Authority;
  chapter: number | null;
  entryStatus: CatalogEntry['status'];
  catalogVersion: string;
  sources: readonly {
    key: string;
    locator: string;
    url: string | null;
    verifiedOn: string | null;
  }[];
}

export type RuleShape =
  | { kind: 'expiration'; leadDays: readonly number[] }
  | {
      kind: 'periodic';
      basis: 'since_last_completion' | 'calendar_period';
      leadDays: readonly number[];
    }
  | { kind: 'one_time' }
  | { kind: 'on_change' };

export interface EvaluationResult {
  requirementId: string;
  catalogVersion: string;
  engineVersion: string;
  status: ReadinessStatus;
  /** The site calendar date the evaluation used. */
  asOfDate: CalendarDate;
  nextDueOn: CalendarDate | null;
  daysUntilDue: number | null;
  /** The most urgent lead-day tier reached (e.g. 30), or null. */
  leadTier: number | null;
  rule: RuleShape['kind'] | null;
  /** The period length used (months), when the rule is periodic. */
  intervalMonths: number | null;
  reasons: readonly Reason[];
  /** One line for people: status, why, and the internal-readiness label. */
  summary: string;
  citation: Citation;
  /** Always true: readiness is internal, never an HRSA or State of Florida determination. */
  internalOnly: true;
}
