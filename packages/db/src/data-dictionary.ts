/**
 * Data dictionary: every column of every table, with its sensitivity class
 * (docs/security/data-classification.md). A column without an entry fails the
 * @deemed/db tests, and docs/data/data-dictionary.md is generated from this file
 * (`pnpm --filter @deemed/db dictionary`). ADR-0008 section 5 drives audit redaction
 * from these classes.
 *
 * No SSN column exists anywhere (decision D1); the tests also run the SSN-like column
 * detector over every column name.
 */

export type SensitivityClass = 'public' | 'internal' | 'confidential' | 'PII' | 'PHI';

export interface ColumnEntry {
  class: SensitivityClass;
  description: string;
  /** Field-level envelope encryption (ADR-0007) or a keyed blind index of such a field. */
  encryption?: 'field' | 'blind_index';
  /** Florida FIPA "personal information" tag (Fla. Stat. 501.171, list to verify under FL-PRIV-2). */
  fipa?: 'yes' | 'no' | 'to_verify';
  /** UI and API default. Masked/hidden fields need an audited reveal. */
  display?: 'shown' | 'masked' | 'hidden';
  /**
   * Free text people type (reasons, comments). It may hold anything, so it is PII and
   * the audit diff keeps only its length and a per-tenant HMAC (ADR-0008 section 5).
   */
  freeText?: boolean;
}

export interface TableEntry {
  description: string;
  /** tenant: organization_id + forced RLS; global: reference data; platform: cross-tenant registry. */
  scope: 'tenant' | 'global' | 'platform';
  owner: string;
  columns: Record<string, ColumnEntry>;
}

const c = (
  cls: SensitivityClass,
  description: string,
  extra: Omit<ColumnEntry, 'class' | 'description'> = {},
): ColumnEntry => ({ class: cls, description, ...extra });

const rowMeta = {
  created_at: c('internal', 'When the row was created (UTC), set by the database'),
  created_by: c('internal', 'user_account that created the row, from the transaction actor'),
  updated_at: c('internal', 'When the row last changed (UTC), set by the database'),
  updated_by: c('internal', 'user_account that last changed the row'),
};
const archived = {
  archived_at: c('internal', 'Soft-delete time; archived rows are hidden, never hard-deleted'),
};
const tenantKey = {
  organization_id: c('internal', 'Tenant (organization) that owns the row; RLS key'),
};
const testFlag = {
  is_test_record: c('internal', 'Synthetic record from fixtures or seeds (test: true)'),
};

export const DATA_DICTIONARY: Record<string, TableEntry> = {
  'public.organization': {
    description: 'The health center (tenant). Florida only (D4).',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Organization id; the tenant id'),
      legal_name: c('confidential', 'Legal name of the health center'),
      award_type: c('internal', 'section330 (§330 recipient) or lookalike (Look-Alike)'),
      sub_programs: c('internal', 'CHC, MHC, HCH, PHPC'),
      grant_number: c('confidential', 'HRSA grant or designation number'),
      npi: c('confidential', 'Organization (type 2) NPI'),
      time_zone: c('internal', 'Default time zone: America/New_York or America/Chicago'),
      is_public_agency: c(
        'internal',
        'Public agency or co-applicant (FL-D3); turns on FL-SUNSHINE',
      ),
      address_line1: c('confidential', 'Business address'),
      address_line2: c('confidential', 'Business address, second line'),
      city: c('confidential', 'Business address city'),
      state: c('internal', 'Always FL (D4)'),
      postal_code: c('confidential', 'Florida ZIP code'),
      ...testFlag,
      ...rowMeta,
      ...archived,
    },
  },
  'public.site': {
    description: 'A health center site; links to Form 5B.',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Site id'),
      ...tenantKey,
      name: c('internal', 'Site name'),
      form_5b_site_id: c('internal', 'Form 5B site identifier'),
      site_type: c(
        'internal',
        'service_delivery, administrative, mobile, intermittent, seasonal, other',
      ),
      address_line1: c('confidential', 'Site address'),
      address_line2: c('confidential', 'Site address, second line'),
      city: c('confidential', 'Site city'),
      state: c('internal', 'Always FL (D4)'),
      postal_code: c('confidential', 'Florida ZIP code'),
      time_zone: c('internal', 'America/New_York or America/Chicago (western Panhandle)'),
      valid_from: c('internal', 'First day the site is in scope'),
      valid_to: c('internal', 'Last day the site is in scope; NULL while current'),
      ...testFlag,
      ...rowMeta,
      ...archived,
    },
  },
  'public.person': {
    description:
      'One row per human: staff, provider, board member, contractor contact, auditor. No SSN (D1).',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Person id'),
      ...tenantKey,
      given_name: c('PII', 'Given name', { fipa: 'to_verify', display: 'shown' }),
      family_name: c('PII', 'Family name', { fipa: 'to_verify', display: 'shown' }),
      preferred_name: c('PII', 'Preferred name', { display: 'shown' }),
      work_email: c('PII', 'Work email', { fipa: 'to_verify', display: 'shown' }),
      dob_enc: c('PII', 'Date of birth, field-encrypted under the tenant key', {
        encryption: 'field',
        fipa: 'to_verify',
        display: 'masked',
      }),
      dob_bidx: c('PII', 'Keyed HMAC blind index of the DOB for screening matches', {
        encryption: 'blind_index',
        display: 'hidden',
      }),
      home_address_enc: c('PII', 'Home address, field-encrypted under the tenant key', {
        encryption: 'field',
        fipa: 'to_verify',
        display: 'masked',
      }),
      npi: c('PII', 'Individual (type 1) NPI', { fipa: 'no', display: 'shown' }),
      ...testFlag,
      ...rowMeta,
      ...archived,
    },
  },
  'public.user_account': {
    description: 'Sign-in identity for a person (ADR-0006).',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'User account id; the actor id in audit events'),
      ...tenantKey,
      person_id: c('internal', 'The person this account belongs to'),
      idp_issuer: c('internal', 'Identity provider issuer'),
      idp_subject: c('confidential', 'Subject identifier at the identity provider'),
      login_email: c('PII', 'Sign-in email', { fipa: 'to_verify', display: 'shown' }),
      status: c('internal', 'invited, active, suspended, deprovisioned'),
      mfa_enrolled_at: c('internal', 'When MFA enrollment completed'),
      last_login_at: c('internal', 'Last successful sign-in'),
      ...testFlag,
      ...rowMeta,
      ...archived,
    },
  },
  'public.role': {
    description: 'Default roles from the module map. Global reference data.',
    scope: 'global',
    owner: 'security-privacy-officer',
    columns: {
      key: c('public', 'Stable role key'),
      name_en: c('public', 'Role name, English'),
      name_es: c('public', 'Role name, Spanish'),
      description_en: c('public', 'What the role sees'),
      is_read_only: c('public', 'Role cannot change data'),
      requires_expiry: c('public', 'Assignments must carry an expiry (auditor)'),
      max_duration: c('public', 'Longest allowed assignment when an expiry is required'),
    },
  },
  'public.role_assignment': {
    description: 'Role granted to a user, optionally limited to a site and optionally expiring.',
    scope: 'tenant',
    owner: 'security-privacy-officer',
    columns: {
      id: c('internal', 'Assignment id'),
      ...tenantKey,
      user_account_id: c('internal', 'Grantee'),
      role_key: c('internal', 'Granted role'),
      site_id: c('internal', 'Site scope; NULL means all sites'),
      valid_from: c('internal', 'Start of the grant'),
      expires_at: c('internal', 'End of the grant; required for auditors (max 30 days)'),
      grant_reason: c('PII', 'Why the role was granted (free text)', { freeText: true }),
      revoked_at: c('internal', 'When the grant was revoked'),
      revoked_by: c('internal', 'Who revoked it (NULL for a service actor)'),
      revoke_reason: c('PII', 'Why the grant was revoked (free text)', { freeText: true }),
      ...rowMeta,
      approval_area: c('internal', 'Executive grants only: approval area (public.approval_area)'),
    },
  },
  'public.approval_area': {
    description:
      'Executive approval areas: which modules an executive grant may approve. Confirmed by the product owner (D16).',
    scope: 'global',
    owner: 'security-privacy-officer',
    columns: {
      key: c('internal', 'Area key'),
      modules: c('internal', 'Module ids the area covers'),
      description_en: c('internal', 'Description (English)'),
      status: c('internal', 'confirmed (or proposed for a new area awaiting sign-off)'),
    },
  },
  'auth.local_credential': {
    description: 'Local account password (ADR-0006 rule 2). Argon2id hash only.',
    scope: 'tenant',
    owner: 'security-privacy-officer',
    columns: {
      id: c('internal', 'Credential id'),
      ...tenantKey,
      user_account_id: c('internal', 'Account the password belongs to'),
      password_hash: c('confidential', 'Argon2id PHC string; never plaintext', {
        display: 'hidden',
      }),
      password_set_at: c('internal', 'When the password was set'),
      ...rowMeta,
    },
  },
  'auth.auth_factor': {
    description: 'MFA factor: passkey (WebAuthn) or TOTP. No SMS or email codes (ADR-0006 rule 3).',
    scope: 'tenant',
    owner: 'security-privacy-officer',
    columns: {
      id: c('internal', 'Factor id'),
      ...tenantKey,
      user_account_id: c('internal', 'Account the factor belongs to'),
      kind: c('internal', 'totp or passkey'),
      label: c('internal', 'Name shown to the user (e.g. "Authenticator app")'),
      // Class PII: with the login email it is an account credential (FIPA 501.171 to verify).
      totp_secret_enc: c('PII', 'TOTP secret, AES-256-GCM envelope', {
        encryption: 'field',
        fipa: 'to_verify',
        display: 'hidden',
      }),
      totp_last_step: c('internal', 'Last accepted TOTP time step (replay guard)'),
      webauthn_credential_id: c('internal', 'Passkey credential id (base64url)'),
      webauthn_public_key: c('internal', 'Passkey COSE public key'),
      webauthn_counter: c('internal', 'Passkey signature counter'),
      webauthn_transports: c('internal', 'Passkey transports hint'),
      verified_at: c('internal', 'When the factor was proven during enrollment'),
      last_used_at: c('internal', 'Last successful use'),
      revoked_at: c('internal', 'When the factor was revoked (MFA reset)'),
      revoke_reason: c('internal', 'Why the factor was revoked (code, e.g. mfa_reset)'),
      ...rowMeta,
    },
  },
  'auth.login_attempt': {
    description: 'A sign-in between the password and the second factor (10 minutes at most).',
    scope: 'tenant',
    owner: 'security-privacy-officer',
    columns: {
      id: c('internal', 'Attempt id'),
      ...tenantKey,
      user_account_id: c('internal', 'Account signing in'),
      token_hash: c('confidential', 'SHA-256 of the pending sign-in cookie', { display: 'hidden' }),
      created_at: c('internal', 'Start of the attempt'),
      expires_at: c('internal', 'End of the attempt'),
      password_verified_at: c('internal', 'When the password was verified'),
      webauthn_challenge: c('internal', 'Outstanding WebAuthn challenge'),
      failed_mfa_count: c('internal', 'Wrong second-factor answers in this attempt'),
      consumed_at: c('internal', 'When the attempt became a session'),
      ip_address: c('PII', 'Client IP address', { fipa: 'no', display: 'masked' }),
      user_agent: c('internal', 'Client user agent'),
    },
  },
  'auth.enrollment_token': {
    description:
      'Single-use, expiring token that allows enrolling a first MFA factor; issued by invitation or MFA reset and delivered out of band.',
    scope: 'tenant',
    owner: 'security-privacy-officer',
    columns: {
      id: c('internal', 'Token id'),
      ...tenantKey,
      user_account_id: c('internal', 'Account the token lets enroll'),
      token_hash: c('confidential', 'SHA-256 of the token', { display: 'hidden' }),
      purpose: c('internal', 'invite or mfa_reset'),
      created_at: c('internal', 'When the token was issued'),
      expires_at: c('internal', 'When it stops working (at most 7 days)'),
      consumed_at: c('internal', 'When it was used to enroll'),
      revoked_at: c('internal', 'When it was revoked (superseded or MFA reset)'),
      issued_by: c('internal', 'user_account that issued it (NULL for the platform)'),
    },
  },
  'auth.session': {
    description:
      'Server-side session (ADR-0006 rule 4): 15-minute idle, 12-hour absolute, one tenant, MFA required.',
    scope: 'tenant',
    owner: 'security-privacy-officer',
    columns: {
      id: c('internal', 'Session id'),
      ...tenantKey,
      user_account_id: c('internal', 'Signed-in account'),
      token_hash: c('confidential', 'SHA-256 of the session cookie', { display: 'hidden' }),
      issued_at: c('internal', 'Sign-in time'),
      last_seen_at: c('internal', 'Last request (idle timeout)'),
      absolute_expires_at: c('internal', 'Absolute end (at most 12 hours)'),
      idle_timeout_seconds: c('internal', 'Idle timeout (at most 900 seconds)'),
      mfa_method: c('internal', 'Second factor used at sign-in'),
      mfa_factor_id: c('internal', 'Factor used at sign-in'),
      mfa_at: c('internal', 'When the second factor was verified'),
      reauth_at: c('internal', 'Last step-up (re-authentication)'),
      reauth_challenge: c('internal', 'Outstanding WebAuthn challenge for a passkey step-up'),
      rotate_required: c('internal', 'Token must rotate on the next request (privilege change)'),
      rotated_at: c('internal', 'Last token rotation'),
      revoked_at: c('internal', 'When the session ended'),
      revoke_reason: c('internal', 'logout, idle, absolute, mfa_reset, deprovisioned, admin'),
      ip_address: c('PII', 'Client IP address at sign-in', { fipa: 'no', display: 'masked' }),
      user_agent: c('internal', 'Client user agent at sign-in'),
    },
  },
  'public.requirement_instance': {
    description: 'A catalog requirement applied to an organization, site, or person.',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Instance id'),
      ...tenantKey,
      requirement_id: c('public', 'Catalog requirementId'),
      requirement_version_id: c(
        'internal',
        'Catalog requirement version (FK arrives with the catalog tables)',
      ),
      subject_type: c('internal', 'organization, site, or person'),
      subject_id: c('internal', 'Subject row id'),
      site_id: c('internal', 'Site the instance belongs to, if any'),
      owner_person_id: c('internal', 'Accountable person'),
      status: c('internal', 'met, due_soon, overdue, missing, not_applicable'),
      not_applicable_reason: c('PII', 'Required reason when status is not_applicable (free text)', {
        freeText: true,
      }),
      next_due_on: c('internal', 'Next due date (site or organization time zone)'),
      status_computed_at: c('internal', 'When the readiness engine last computed the status'),
      ...rowMeta,
      ...archived,
    },
  },
  'public.task': {
    description: 'Work item, usually generated by a requirement instance.',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Task id'),
      ...tenantKey,
      requirement_instance_id: c('internal', 'Requirement instance that generated the task'),
      site_id: c('internal', 'Site scope'),
      assignee_person_id: c('internal', 'Assignee'),
      title: c('internal', 'Task title; must not contain personal data beyond names'),
      due_on: c('internal', 'Due date'),
      status: c('internal', 'open, in_progress, blocked, done, cancelled'),
      completed_at: c('internal', 'When the task was done'),
      ...rowMeta,
      ...archived,
    },
  },
  'public.approval': {
    description: 'A human approval or rejection. Insert-only; AI never approves.',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Approval id'),
      ...tenantKey,
      task_id: c('internal', 'Task the decision closes, if any'),
      subject_type: c('internal', 'Kind of record approved'),
      subject_id: c('internal', 'Record approved'),
      approver_person_id: c('internal', 'Approving person'),
      approver_user_account_id: c(
        'internal',
        'Approving user account; must be the transaction actor',
      ),
      decision: c('internal', 'approved or rejected'),
      comment: c('PII', 'Approver comment (free text)', { freeText: true }),
      requirement_ids: c('public', 'Catalog requirementIds the decision supports'),
      decided_at: c('internal', 'Decision time (UTC)'),
      ...rowMeta,
    },
  },
  'audit.action_registry': {
    description: 'Registered audit actions and their category. Global reference data.',
    scope: 'global',
    owner: 'data-architect',
    columns: {
      action: c('public', '<entity>.<verb>'),
      category: c('public', 'Audit category'),
      description: c('public', 'What the action records'),
    },
  },
  'audit.audit_event': {
    description: 'Append-only audit log with a per-tenant SHA-256 hash chain (ADR-0008).',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      id: c('internal', 'Event id (UUIDv7)'),
      ...tenantKey,
      chain_seq: c('internal', 'Gapless sequence within the tenant chain'),
      occurred_at: c('internal', 'Database time (UTC); partition key'),
      category: c(
        'internal',
        'auth, mutation, reveal, export, approval, permission, integration, system',
      ),
      action: c('internal', 'Registered action'),
      outcome: c('internal', 'success, denied, failure'),
      actor_type: c('internal', 'user, service, integration, system, break_glass'),
      actor_person_id: c('internal', 'Acting person'),
      actor_user_id: c('internal', 'Acting user account'),
      actor_label: c('PII', 'Actor display name at the time of the event', { display: 'shown' }),
      on_behalf_of_id: c('internal', 'Human on whose behalf a service acted'),
      session_id: c('internal', 'Session id'),
      request_id: c('internal', 'Correlation id'),
      ip_address: c('PII', 'Client IP address', { display: 'shown' }),
      user_agent: c('internal', 'Client user agent'),
      site_id: c('internal', 'Site the event concerns'),
      target_table: c('internal', 'Table of the changed record'),
      target_id: c('internal', 'Id of the changed record'),
      requirement_ids: c('public', 'Catalog requirementIds the change touches'),
      reason: c('confidential', 'Required for reveals, overrides, break-glass, hard deletes'),
      diff: c('confidential', 'Redacted before/after; encrypted fields appear only as references'),
      metadata: c('confidential', 'Structured context; never PHI or SSN-shaped values'),
      schema_version: c('internal', 'Canonical-form version'),
      prev_hash: c('internal', 'row_hash of the previous event (32 zero bytes for genesis)'),
      row_hash: c('internal', 'SHA-256(prev_hash || canonical row)'),
    },
  },
  'audit.chain_head': {
    description: 'Latest chain position per tenant; re-derivable from audit_event.',
    scope: 'tenant',
    owner: 'data-architect',
    columns: {
      ...tenantKey,
      chain_seq: c('internal', 'Latest chain_seq'),
      row_hash: c('internal', 'Latest row_hash'),
      updated_at: c('internal', 'When the head moved'),
    },
  },
  'platform.tenant': {
    description: 'Cross-tenant registry for platform jobs; no runtime role reads it directly.',
    scope: 'platform',
    owner: 'data-architect',
    columns: {
      ...tenantKey,
      status: c('internal', 'active, suspended, offboarding'),
      time_zone: c('internal', 'Organization default time zone'),
      is_test_record: c('internal', 'Synthetic tenant'),
      provisioned_at: c('internal', 'When the tenant was provisioned'),
      provisioned_by: c('internal', 'Platform actor label or database user that provisioned it'),
    },
  },
  'platform.login_directory': {
    description:
      'Login email to tenant for sign-in; read only through auth.resolve_login (ids only).',
    scope: 'platform',
    owner: 'security-privacy-officer',
    columns: {
      ...tenantKey,
      user_account_id: c('internal', 'Account'),
      email_lower: c('PII', 'Login email, lower case', { fipa: 'to_verify', display: 'hidden' }),
      is_active: c('internal', 'Account can sign in'),
      updated_at: c('internal', 'Last sync from user_account'),
    },
  },
  'platform.auth_throttle': {
    description:
      'Sign-in throttle and lockout state per account or IP prefix, keyed by a SHA-256 digest.',
    scope: 'platform',
    owner: 'security-privacy-officer',
    columns: {
      key_hash: c('internal', 'SHA-256 of "account:<email>" or "ip:<prefix>"'),
      scope: c('internal', 'account or ip'),
      failures: c('internal', 'Failures in the current window'),
      window_started_at: c('internal', 'Start of the counting window'),
      locked_until: c('internal', 'Locked until this time'),
      updated_at: c('internal', 'Last change'),
    },
  },
};

/** Markdown rendering of the dictionary for docs/data/data-dictionary.md. */
export function renderDataDictionaryMarkdown(): string {
  const lines: string[] = [
    '# Data dictionary: core shared entities',
    '',
    '<!-- Generated from packages/db/src/data-dictionary.ts by `pnpm --filter @deemed/db dictionary`. Do not edit by hand. -->',
    '',
    'Owner: `data-architect`. Classes follow `docs/security/data-classification.md`.',
    'Every column of every table in the `public`, `audit`, `auth`, and `platform` schemas is listed;',
    'the `@deemed/db` tests fail when a column is missing here. No SSN column exists (decision D1).',
    '',
    'Scope: **tenant** = `organization_id` (or `organization.id`) with forced RLS;',
    '**global** = reference data, read-only to `app_user`; **platform** = cross-tenant, no runtime access.',
    '',
  ];
  for (const [table, entry] of Object.entries(DATA_DICTIONARY)) {
    lines.push(
      `## \`${table}\``,
      '',
      `${entry.description} Scope: ${entry.scope}. Owner: \`${entry.owner}\`.`,
      '',
    );
    lines.push('| Column | Class | Description | Encryption | FIPA PI | Display |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const [column, col] of Object.entries(entry.columns)) {
      lines.push(
        `| \`${column}\` | ${col.class} | ${col.description} | ${col.encryption ?? 'at rest'} | ${col.fipa ?? 'no'} | ${col.display ?? 'shown'} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
