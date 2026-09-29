/** Stable service error codes (the API maps them to its error model; never a message). */
export type ReadinessErrorCode =
  | 'not_found'
  | 'human_actor_required'
  | 'actor_not_allowed'
  | 'no_catalog_release'
  | 'not_in_catalog'
  | 'not_applicable_not_allowed'
  | 'already_not_applicable'
  | 'not_marked_not_applicable'
  | 'invalid_reason'
  | 'parameter_unknown'
  | 'parameter_out_of_bounds'
  | 'invalid_fact'
  | 'fact_retracted'
  | 'version_conflict'
  | 'bundle_invalid'
  | 'bundle_channel_mismatch'
  | 'bundle_not_verified';

export class ReadinessError extends Error {
  override name = 'ReadinessError';
  constructor(
    readonly code: ReadinessErrorCode,
    readonly fields: readonly string[] = [],
    /** version_conflict: the record's current row version. */
    readonly currentVersion?: number,
  ) {
    super(code);
  }
}
