// Readiness engine strings (S4). Drafted by backend-engineer; ux-content-writer owns the
// final copy. Reason texts must match REASON_TEMPLATES in packages/readiness (a test
// checks), with the same {placeholders}. Every status is internal readiness, never an
// HRSA determination.
export const readinessEn = {
  'readiness.status.met': 'Met',
  'readiness.status.due_soon': 'At risk (due soon)',
  'readiness.status.overdue': 'Not met (overdue)',
  'readiness.status.missing': 'Not met (missing)',
  'readiness.status.not_applicable': 'Not applicable',
  'readiness.status.not_assessed': 'Not assessed',

  'readiness.label.hrsa': 'Internal readiness status, not an HRSA determination.',
  'readiness.label.florida':
    'Florida requirement. Internal readiness status, not a determination by HRSA or the State of Florida.',
  'readiness.label.best_practice':
    'Best practice, not an HRSA requirement. Internal readiness status, not an HRSA determination.',

  'readiness.reason.no_catalog_release':
    'Not assessed: no catalog release is published in this environment yet.',
  'readiness.reason.not_in_catalog':
    'Not assessed: this requirement is not in catalog {catalogVersion} for this environment.',
  'readiness.reason.entry_not_verified':
    'Not assessed: this catalog entry is not verified, so production does not evaluate it.',
  'readiness.reason.entry_retired':
    'Not assessed: this requirement was retired in catalog {catalogVersion}.',
  'readiness.reason.not_effective':
    'Not assessed: this requirement is not in effect on {asOfDate}.',
  'readiness.reason.outside_applicability':
    'Not assessed: this requirement does not apply to this subject ({dimension}).',
  'readiness.reason.marked_not_applicable':
    'Marked not applicable on {decidedOn}, with a recorded reason.',
  'readiness.reason.na_superseded_needs_review':
    'A "not applicable" mark is on file, but this catalog version does not allow it. The mark is kept; please review it.',
  'readiness.reason.tenant_parameter_unset':
    'Not assessed: set "{parameter}" for your health center (allowed {min} to {max}).',
  'readiness.reason.tenant_parameter_out_of_bounds':
    'Not assessed: your value for "{parameter}" ({value}) is outside the allowed {min} to {max}.',
  'readiness.reason.rule_unresolved':
    'Not assessed: the catalog entry has no rule the engine can evaluate.',
  'readiness.reason.threshold_not_evaluated':
    'Not assessed: this requirement has a threshold the readiness engine does not evaluate yet.',
  'readiness.reason.no_evidence': 'No qualifying evidence is on file.',
  'readiness.reason.evidence_type_not_accepted':
    'Evidence on file is not a type this requirement accepts, so it does not count.',
  'readiness.reason.approval_capacity_insufficient':
    'An approval on file was not recorded in the required capacity ({required}).',
  'readiness.reason.approval_rejected': 'The latest approval decision on file was a rejection.',
  'readiness.reason.approval_type_missing':
    'An approval on file does not say what it approved, so it does not count.',
  'readiness.reason.valid_through': 'Valid through {date}.',
  'readiness.reason.expires_today': 'Expires today ({date}); valid until midnight site time.',
  'readiness.reason.expired': 'Expired on {date}.',
  'readiness.reason.due_on': 'Next due {date}.',
  'readiness.reason.due_today': 'Due today ({date}).',
  'readiness.reason.past_due': 'Was due {date}.',
  'readiness.reason.lead_tier': 'Within the {days}-day reminder window.',
  'readiness.reason.period_satisfied': 'Done for the period {periodStart} to {periodEnd}.',
  'readiness.reason.period_pending': 'Due by {periodEnd} for the current period.',
  'readiness.reason.period_missed': 'Nothing on file for the period {periodStart} to {periodEnd}.',
  'readiness.reason.evidence_on_file': 'Evidence on file, dated {date}.',
  'readiness.reason.changed_since_evidence':
    'The underlying fact changed on {date}, after the evidence on file.',
  'readiness.reason.draft_entry':
    'Draft catalog entry (not verified): shown in non-production only.',
} as const;
