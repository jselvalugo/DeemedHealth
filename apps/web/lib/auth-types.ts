// Types shared by the sign-in forms (client) and the auth stub (server).
import type { MessageKey } from '@deemed/i18n';

export type AuthErrorCode =
  | 'email_required'
  | 'email_invalid'
  | 'password_required'
  | 'invalid_credentials'
  | 'locked'
  | 'code_required'
  | 'code_format'
  | 'code_invalid'
  | 'recovery_required'
  | 'recovery_invalid'
  | 'expired'
  | 'unexpected';

export type AuthField = 'email' | 'password' | 'code';

/** Result of every sign-in server action. Success redirects instead of returning. */
export type AuthFormState =
  | { status: 'idle' }
  | { status: 'method'; email: string; sso: boolean }
  | { status: 'error'; code: AuthErrorCode; field?: AuthField }
  | { status: 'not_implemented' };

export const IDLE: AuthFormState = { status: 'idle' };

export const ERROR_MESSAGES: Record<AuthErrorCode, MessageKey> = {
  email_required: 'signIn.email.required',
  email_invalid: 'signIn.email.invalid',
  password_required: 'signIn.password.required',
  invalid_credentials: 'signIn.error.invalid',
  locked: 'signIn.error.locked',
  code_required: 'mfa.code.required',
  code_format: 'mfa.code.format',
  code_invalid: 'mfa.code.invalid',
  recovery_required: 'recovery.code.required',
  recovery_invalid: 'recovery.code.invalid',
  expired: 'mfa.expired.body',
  unexpected: 'signIn.error.unexpected',
};

/** The error message for `field`, if the state carries one. */
export function fieldError(state: AuthFormState, field: AuthField): AuthErrorCode | undefined {
  return state.status === 'error' && state.field === field ? state.code : undefined;
}

/** A form-level error (no field), including "not implemented". */
export function formError(state: AuthFormState): MessageKey | undefined {
  if (state.status === 'not_implemented') return 'signIn.error.notImplemented';
  if (state.status === 'error' && !state.field) return ERROR_MESSAGES[state.code];
  return undefined;
}
