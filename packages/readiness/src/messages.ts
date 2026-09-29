import type { Authority, ReadinessStatus, Reason, ReasonCode, ReasonParams } from './types.js';

/**
 * Plain-English reason templates. The UI uses `messageKey` with the EN/ES catalogs in
 * packages/i18n (same placeholders); these strings are for logs, exports, and tests.
 * Placeholders are `{name}`; no personal data is ever a parameter.
 */
export const REASON_TEMPLATES: Readonly<Record<ReasonCode, string>> = {
  no_catalog_release: 'Not assessed: no catalog release is published in this environment yet.',
  not_in_catalog:
    'Not assessed: this requirement is not in catalog {catalogVersion} for this environment.',
  entry_not_verified:
    'Not assessed: this catalog entry is not verified, so production does not evaluate it.',
  entry_retired: 'Not assessed: this requirement was retired in catalog {catalogVersion}.',
  not_effective: 'Not assessed: this requirement is not in effect on {asOfDate}.',
  outside_applicability:
    'Not assessed: this requirement does not apply to this subject ({dimension}).',
  marked_not_applicable: 'Marked not applicable on {decidedOn}, with a recorded reason.',
  na_superseded_needs_review:
    'A "not applicable" mark is on file, but this catalog version does not allow it. The mark is kept; please review it.',
  tenant_parameter_unset:
    'Not assessed: set "{parameter}" for your health center (allowed {min} to {max}).',
  tenant_parameter_out_of_bounds:
    'Not assessed: your value for "{parameter}" ({value}) is outside the allowed {min} to {max}.',
  rule_unresolved: 'Not assessed: the catalog entry has no rule the engine can evaluate.',
  threshold_not_evaluated:
    'Not assessed: this requirement has a threshold the readiness engine does not evaluate yet.',
  no_evidence: 'No qualifying evidence is on file.',
  evidence_type_not_accepted:
    'Evidence on file is not a type this requirement accepts, so it does not count.',
  approval_capacity_insufficient:
    'An approval on file was not recorded in the required capacity ({required}).',
  approval_rejected: 'The latest approval decision on file was a rejection.',
  approval_type_missing: 'An approval on file does not say what it approved, so it does not count.',
  valid_through: 'Expiration date on file: {date}.',
  expires_today:
    'Expiration date on file is today ({date}); counted as current until midnight site time.',
  expired: 'Expired on {date}.',
  due_on: 'Next due {date}.',
  due_today: 'Due today ({date}).',
  past_due: 'Was due {date}.',
  lead_tier: 'Within the {days}-day reminder window.',
  period_satisfied: 'A record is on file for the period {periodStart} to {periodEnd}.',
  period_pending: 'Due by {periodEnd} for the current period.',
  period_missed: 'Nothing on file for the period {periodStart} to {periodEnd}.',
  period_missed_in_lookback:
    'In the last {lookbackMonths} months, {count} calendar period(s) had nothing on file: {periods}.',
  evidence_on_file: 'Evidence on file, dated {date}.',
  changed_since_evidence: 'The underlying fact changed on {date}, after the evidence on file.',
  draft_entry: 'Draft catalog entry (not verified): shown in non-production only.',
};

const STATUS_WORDS: Readonly<Record<ReadinessStatus, string>> = {
  met: 'Met',
  due_soon: 'At risk (due soon)',
  overdue: 'Not met (overdue)',
  missing: 'Not met (missing)',
  not_applicable: 'Not applicable',
  not_assessed: 'Not assessed',
};

/** The label every result carries (roadmap section 2 rule 5). */
export const INTERNAL_LABEL: Readonly<Record<Authority, string>> = {
  hrsa: 'Internal readiness status, not an HRSA determination.',
  florida:
    'Florida requirement. Internal readiness status, not a determination by HRSA or the State of Florida.',
  best_practice:
    'Best practice, not an HRSA requirement. Internal readiness status, not an HRSA determination.',
};

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

export function render(template: string, params: ReasonParams): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

export function reason(code: ReasonCode, params: ReasonParams = {}): Reason {
  return {
    code,
    messageKey: `readiness.reason.${code}`,
    params,
    message: render(REASON_TEMPLATES[code], params),
  };
}

export function summarize(
  status: ReadinessStatus,
  reasons: readonly Reason[],
  authority: Authority,
): string {
  const why = reasons.map((r) => r.message).join(' ');
  return `${STATUS_WORDS[status]}. ${why ? `${why} ` : ''}${INTERNAL_LABEL[authority]}`;
}
