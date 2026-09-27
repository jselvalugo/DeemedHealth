/**
 * Identity tables (migration 0004, ADR-0006, ADR-0010 section 6). Tenant tables in the
 * `auth` schema with forced RLS. Tokens are stored only as SHA-256 digests; TOTP
 * secrets only field-encrypted; passwords only as Argon2id PHC strings.
 */
import { bigint, boolean, inet, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, rowMeta, timestamptz } from './columns.js';

export const authSchema = pgSchema('auth');

export const AUTH_FACTOR_KINDS = ['totp', 'passkey'] as const;
export type AuthFactorKind = (typeof AUTH_FACTOR_KINDS)[number];

export const SESSION_REVOKE_REASONS = [
  'logout',
  'idle',
  'absolute',
  'mfa_reset',
  'deprovisioned',
  'admin',
  'replaced',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export const localCredential = authSchema.table('local_credential', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userAccountId: uuid('user_account_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSetAt: timestamptz('password_set_at').notNull(),
  ...rowMeta(),
});

export const authFactor = authSchema.table('auth_factor', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userAccountId: uuid('user_account_id').notNull(),
  kind: text('kind', { enum: AUTH_FACTOR_KINDS }).notNull(),
  label: text('label').notNull(),
  totpSecretEnc: bytea('totp_secret_enc'),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  webauthnCredentialId: text('webauthn_credential_id'),
  webauthnPublicKey: bytea('webauthn_public_key'),
  webauthnCounter: bigint('webauthn_counter', { mode: 'number' }),
  webauthnTransports: text('webauthn_transports').array(),
  verifiedAt: timestamptz('verified_at'),
  lastUsedAt: timestamptz('last_used_at'),
  revokedAt: timestamptz('revoked_at'),
  revokeReason: text('revoke_reason'),
  ...rowMeta(),
});

export const loginAttempt = authSchema.table('login_attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userAccountId: uuid('user_account_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  createdAt: timestamptz('created_at').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  passwordVerifiedAt: timestamptz('password_verified_at').notNull(),
  webauthnChallenge: text('webauthn_challenge'),
  failedMfaCount: integer('failed_mfa_count').notNull().default(0),
  consumedAt: timestamptz('consumed_at'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
});

export const session = authSchema.table('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userAccountId: uuid('user_account_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  issuedAt: timestamptz('issued_at').notNull(),
  lastSeenAt: timestamptz('last_seen_at').notNull(),
  absoluteExpiresAt: timestamptz('absolute_expires_at').notNull(),
  idleTimeoutSeconds: integer('idle_timeout_seconds').notNull().default(900),
  mfaMethod: text('mfa_method', { enum: AUTH_FACTOR_KINDS }).notNull(),
  mfaFactorId: uuid('mfa_factor_id').notNull(),
  mfaAt: timestamptz('mfa_at').notNull(),
  reauthAt: timestamptz('reauth_at').notNull(),
  reauthChallenge: text('reauth_challenge'),
  rotateRequired: boolean('rotate_required').notNull().default(false),
  rotatedAt: timestamptz('rotated_at'),
  revokedAt: timestamptz('revoked_at'),
  revokeReason: text('revoke_reason', { enum: SESSION_REVOKE_REASONS }),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
});
