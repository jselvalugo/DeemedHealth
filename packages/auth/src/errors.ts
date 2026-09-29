import type { ApiErrorCode } from '@deemed/domain';

/**
 * An expected authentication outcome, mapped by the API to its stable error code and
 * user-safe message key. The message is for logs only and never holds personal data.
 */
export class AuthError extends Error {
  override name = 'AuthError';

  constructor(
    readonly code: ApiErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}
