/**
 * HTTP contract between apps/api and apps/web (ADR-0001: zod contracts in
 * packages/domain, shared by both). Request bodies are validated by the API with
 * these schemas; the web app parses responses with them.
 *
 * Nothing here carries a password hash, token, TOTP secret, or assertion. Session
 * and pending-sign-in tokens travel only in HttpOnly cookies.
 */
import { z } from 'zod';
import { ModuleIdSchema } from '../modules.js';
import { PermissionSchema, RoleIdSchema } from '../permissions.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable error codes. Each maps to a user-safe message key `apiError.<code>` in
 * packages/i18n. Responses never carry a stack trace, SQL, or personal data.
 */
export const API_ERROR_CODES = [
  'bad_request',
  'unauthenticated',
  'session_expired',
  'reauth_required',
  'mfa_required',
  'mfa_enrollment_required',
  'invalid_credentials',
  'invalid_code',
  'too_many_attempts',
  'organization_required',
  'forbidden',
  'not_found',
  'conflict',
  'csrf_failed',
  'payload_too_large',
  'unsupported',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    /** i18n key; the web app shows t(locale, messageKey). */
    messageKey: z.string(),
    /** Request id; the same value is in the audit event and the logs. */
    correlationId: z.string(),
    /** Validation only: the paths of the invalid fields (never their values). */
    fields: z.array(z.string()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export function apiErrorMessageKey(code: ApiErrorCode): `apiError.${ApiErrorCode}` {
  return `apiError.${code}`;
}

// ---------------------------------------------------------------------------
// Sign-in (ADR-0006 rules 2, 3, 5, 11)
// ---------------------------------------------------------------------------

export const EmailSchema = z.string().trim().toLowerCase().min(3).max(254).email();

export const LoginRequest = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(1024),
    /** Only needed when one email signs in to more than one health center. */
    organizationId: z.string().uuid().optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

export const MFA_METHODS = ['totp', 'passkey'] as const;
export const MfaMethodSchema = z.enum(MFA_METHODS);
export type MfaMethod = z.infer<typeof MfaMethodSchema>;

/** After the password: a second factor is always next. There is no other outcome. */
export const LoginResponse = z.object({
  next: z.enum(['mfa', 'mfa_enroll']),
  /** Verified factors the user can answer with (empty when enrolling). */
  methods: z.array(MfaMethodSchema),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const TotpCodeRequest = z.object({ code: z.string().trim().min(6).max(8) }).strict();
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

export const TotpEnrollmentResponse = z.object({
  /** otpauth:// URI for a QR code, and the base32 secret for manual entry. */
  otpauthUri: z.string(),
  secret: z.string(),
});
export type TotpEnrollmentResponse = z.infer<typeof TotpEnrollmentResponse>;

/** WebAuthn options and responses are passed through as JSON (@simplewebauthn). */
export const PasskeyResponseRequest = z.object({ response: z.record(z.unknown()) }).strict();
export type PasskeyResponseRequest = z.infer<typeof PasskeyResponseRequest>;

export const SessionIssuedResponse = z.object({
  signedIn: z.literal(true),
  csrfToken: z.string(),
});
export type SessionIssuedResponse = z.infer<typeof SessionIssuedResponse>;

export const ReauthResponse = z.object({
  reauthenticatedAt: z.string(),
  /** Seconds the step-up stays valid (ADR-0006 rule 5: 5 minutes). */
  validForSeconds: z.number().int(),
});
export type ReauthResponse = z.infer<typeof ReauthResponse>;

// ---------------------------------------------------------------------------
// Me and navigation
// ---------------------------------------------------------------------------

export const MeResponse = z.object({
  user: z.object({
    userAccountId: z.string().uuid(),
    personId: z.string().uuid(),
    displayName: z.string(),
    email: z.string(),
  }),
  organization: z.object({ id: z.string().uuid(), name: z.string() }),
  roles: z.array(RoleIdSchema),
  /** null: every site of the organization. */
  siteIds: z.array(z.string().uuid()).nullable(),
  permissions: z.array(PermissionSchema),
  session: z.object({
    expiresAt: z.string(),
    idleExpiresAt: z.string(),
    mfaMethod: z.enum(['totp', 'passkey', 'idp']),
    /** When the last step-up happened; drives the re-authentication dialog. */
    reauthenticatedAt: z.string(),
  }),
  /** Send as `x-csrf-token` on every POST, PUT, PATCH, and DELETE. */
  csrfToken: z.string(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const NavigationResponse = z.object({
  modules: z.array(
    z.object({
      id: ModuleIdSchema,
      pages: z.array(z.object({ id: z.string(), route: z.string() })),
    }),
  ),
});
export type NavigationResponse = z.infer<typeof NavigationResponse>;

// ---------------------------------------------------------------------------
// Administration: role grants and MFA reset (all need step-up)
// ---------------------------------------------------------------------------

export const GrantRoleRequest = z
  .object({
    userAccountId: z.string().uuid(),
    roleId: RoleIdSchema,
    /** Omit for all sites. */
    siteId: z.string().uuid().optional(),
    /** Required for the auditor role (at most 30 days after now). */
    expiresAt: z.string().datetime().optional(),
    approvalArea: z.string().min(1).max(40).optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type GrantRoleRequest = z.infer<typeof GrantRoleRequest>;

export const RoleAssignmentView = z.object({
  id: z.string().uuid(),
  userAccountId: z.string().uuid(),
  roleId: z.string(),
  siteId: z.string().uuid().nullable(),
  validFrom: z.string(),
  expiresAt: z.string().nullable(),
  approvalArea: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type RoleAssignmentView = z.infer<typeof RoleAssignmentView>;

export const RevokeRoleRequest = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type RevokeRoleRequest = z.infer<typeof RevokeRoleRequest>;

export const MfaResetRequest = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type MfaResetRequest = z.infer<typeof MfaResetRequest>;

export const MfaResetResponse = z.object({
  factorsRevoked: z.number().int(),
  sessionsRevoked: z.number().int(),
});
export type MfaResetResponse = z.infer<typeof MfaResetResponse>;

// ---------------------------------------------------------------------------
// Readiness (the first record endpoint; the full module ships in S4)
// ---------------------------------------------------------------------------

export const RequirementInstanceView = z.object({
  id: z.string().uuid(),
  requirementId: z.string(),
  subjectType: z.enum(['organization', 'site', 'person']),
  subjectId: z.string().uuid(),
  siteId: z.string().uuid().nullable(),
  ownerPersonId: z.string().uuid().nullable(),
  status: z.string(),
  nextDueOn: z.string().nullable(),
});
export type RequirementInstanceView = z.infer<typeof RequirementInstanceView>;

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  environment: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
