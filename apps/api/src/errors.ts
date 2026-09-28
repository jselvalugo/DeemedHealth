/**
 * The stable error model: every error response is
 *   { error: { code, messageKey, correlationId, fields? } }
 * with an HTTP status from the table below. No stack trace, SQL, or personal data ever
 * reaches a response; logs get the error name, the SQLSTATE, and the route id only.
 */
import {
  apiErrorMessageKey,
  type ApiErrorBody,
  type ApiErrorCode,
  type DenyReason,
} from '@deemed/domain';

export const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  session_expired: 401,
  reauth_required: 401,
  mfa_required: 403,
  mfa_enrollment_required: 403,
  enrollment_token_invalid: 403,
  invalid_credentials: 401,
  invalid_code: 401,
  too_many_attempts: 429,
  organization_required: 409,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  version_conflict: 409,
  precondition_required: 428,
  csrf_failed: 403,
  payload_too_large: 413,
  unsupported: 400,
  not_configured: 503,
  internal: 500,
};

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly code: ApiErrorCode,
    readonly fields?: string[],
  ) {
    super(code);
  }
}

/** What an audited denial records (ADR-0008 section 4: denied attempts are logged). */
export interface DenialTarget {
  table: string;
  id: string;
  siteId?: string | null;
}

/** A request the policy refused. The error handler audits it with outcome = denied. */
export class DeniedError extends ApiError {
  override name = 'DeniedError';

  constructor(
    readonly reason: DenyReason | 'reauth_required' | 'self_service_forbidden',
    readonly target?: DenialTarget,
  ) {
    super(reason === 'reauth_required' ? 'reauth_required' : 'forbidden');
  }
}

export function errorBody(
  code: ApiErrorCode,
  correlationId: string,
  fields?: string[],
): ApiErrorBody {
  return {
    error: {
      code,
      messageKey: apiErrorMessageKey(code),
      correlationId,
      ...(fields && fields.length ? { fields } : {}),
    },
  };
}
