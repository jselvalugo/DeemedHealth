# Data dictionary: core shared entities

<!-- Generated from packages/db/src/data-dictionary.ts by `pnpm --filter @deemed/db dictionary`. Do not edit by hand. -->

Owner: `data-architect`. Classes follow `docs/security/data-classification.md`.
Every column of every table in the `public`, `audit`, `auth`, `platform`, and `catalog` schemas is listed;
the `@deemed/db` tests fail when a column is missing here. No SSN column exists (decision D1).

Scope: **tenant** = `organization_id` (or `organization.id`) with forced RLS;
**global** = reference data, read-only to `app_user`; **platform** = cross-tenant, no runtime access.

## `public.organization`

The health center (tenant). Florida only (D4). Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Organization id; the tenant id | at rest | no | shown |
| `legal_name` | confidential | Legal name of the health center | at rest | no | shown |
| `award_type` | internal | section330 (§330 recipient) or lookalike (Look-Alike) | at rest | no | shown |
| `sub_programs` | internal | CHC, MHC, HCH, PHPC | at rest | no | shown |
| `grant_number` | confidential | HRSA grant or designation number | at rest | no | shown |
| `npi` | confidential | Organization (type 2) NPI | at rest | no | shown |
| `time_zone` | internal | Default time zone: America/New_York or America/Chicago | at rest | no | shown |
| `is_public_agency` | internal | Public agency or co-applicant (FL-D3); turns on FL-SUNSHINE | at rest | no | shown |
| `address_line1` | confidential | Business address | at rest | no | shown |
| `address_line2` | confidential | Business address, second line | at rest | no | shown |
| `city` | confidential | Business address city | at rest | no | shown |
| `state` | internal | Always FL (D4) | at rest | no | shown |
| `postal_code` | confidential | Florida ZIP code | at rest | no | shown |
| `is_test_record` | internal | Synthetic record from fixtures or seeds (test: true) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `archived_by` | internal | user_account that archived the row; always the transaction actor (set_row_meta) | at rest | no | shown |
| `archive_reason` | PII | Why the row was archived (free text) | at rest | no | shown |

## `public.site`

A health center site; links to Form 5B. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Site id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `name` | internal | Site name | at rest | no | shown |
| `form_5b_site_id` | internal | Form 5B site identifier | at rest | no | shown |
| `site_type` | internal | service_delivery, administrative, mobile, intermittent, seasonal, other | at rest | no | shown |
| `address_line1` | confidential | Site address | at rest | no | shown |
| `address_line2` | confidential | Site address, second line | at rest | no | shown |
| `city` | confidential | Site city | at rest | no | shown |
| `state` | internal | Always FL (D4) | at rest | no | shown |
| `postal_code` | confidential | Florida ZIP code | at rest | no | shown |
| `time_zone` | internal | America/New_York or America/Chicago (western Panhandle) | at rest | no | shown |
| `valid_from` | internal | First day the site is in scope | at rest | no | shown |
| `valid_to` | internal | Last day the site is in scope; NULL while current | at rest | no | shown |
| `is_test_record` | internal | Synthetic record from fixtures or seeds (test: true) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `archived_by` | internal | user_account that archived the row; always the transaction actor (set_row_meta) | at rest | no | shown |
| `archive_reason` | PII | Why the row was archived (free text) | at rest | no | shown |

## `public.person`

One row per human: staff, provider, board member, contractor contact, auditor. No SSN (D1). Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Person id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `given_name` | PII | Given name | at rest | to_verify | shown |
| `family_name` | PII | Family name | at rest | to_verify | shown |
| `preferred_name` | PII | Preferred name | at rest | no | shown |
| `work_email` | PII | Work email | at rest | to_verify | shown |
| `dob_enc` | PII | Date of birth, field-encrypted under the tenant key | field | to_verify | masked |
| `dob_bidx` | PII | Keyed HMAC blind index of the DOB for screening matches | blind_index | no | hidden |
| `home_address_enc` | PII | Home address, field-encrypted under the tenant key | field | to_verify | masked |
| `npi` | PII | Individual (type 1) NPI | at rest | no | shown |
| `is_test_record` | internal | Synthetic record from fixtures or seeds (test: true) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `archived_by` | internal | user_account that archived the row; always the transaction actor (set_row_meta) | at rest | no | shown |
| `archive_reason` | PII | Why the row was archived (free text) | at rest | no | shown |

## `public.user_account`

Sign-in identity for a person (ADR-0006). Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | User account id; the actor id in audit events | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `person_id` | internal | The person this account belongs to | at rest | no | shown |
| `idp_issuer` | internal | Identity provider issuer | at rest | no | shown |
| `idp_subject` | confidential | Subject identifier at the identity provider | at rest | no | shown |
| `login_email` | PII | Sign-in email | at rest | to_verify | shown |
| `status` | internal | invited, active, suspended, deprovisioned | at rest | no | shown |
| `mfa_enrolled_at` | internal | When MFA enrollment completed | at rest | no | shown |
| `last_login_at` | internal | Last successful sign-in | at rest | no | shown |
| `is_test_record` | internal | Synthetic record from fixtures or seeds (test: true) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `archived_by` | internal | user_account that archived the row; always the transaction actor (set_row_meta) | at rest | no | shown |
| `archive_reason` | PII | Why the row was archived (free text) | at rest | no | shown |

## `public.role`

Default roles from the module map. Global reference data. Scope: global. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `key` | public | Stable role key | at rest | no | shown |
| `name_en` | public | Role name, English | at rest | no | shown |
| `name_es` | public | Role name, Spanish | at rest | no | shown |
| `description_en` | public | What the role sees | at rest | no | shown |
| `is_read_only` | public | Role cannot change data | at rest | no | shown |
| `requires_expiry` | public | Assignments must carry an expiry (auditor) | at rest | no | shown |
| `max_duration` | public | Longest allowed assignment when an expiry is required | at rest | no | shown |

## `public.role_assignment`

Role granted to a user, optionally limited to a site and optionally expiring. Scope: tenant. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Assignment id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Grantee | at rest | no | shown |
| `role_key` | internal | Granted role | at rest | no | shown |
| `site_id` | internal | Site scope; NULL means all sites | at rest | no | shown |
| `valid_from` | internal | Start of the grant | at rest | no | shown |
| `expires_at` | internal | End of the grant; required for auditors (max 30 days) | at rest | no | shown |
| `grant_reason` | PII | Why the role was granted (free text) | at rest | no | shown |
| `revoked_at` | internal | When the grant was revoked | at rest | no | shown |
| `revoked_by` | internal | Who revoked it (NULL for a service actor) | at rest | no | shown |
| `revoke_reason` | PII | Why the grant was revoked (free text) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `approval_area` | internal | Executive grants only: approval area (public.approval_area) | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |

## `public.approval_area`

Executive approval areas: which modules an executive grant may approve. Confirmed by the product owner (D16). Scope: global. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `key` | internal | Area key | at rest | no | shown |
| `modules` | internal | Module ids the area covers | at rest | no | shown |
| `description_en` | internal | Description (English) | at rest | no | shown |
| `status` | internal | confirmed (or proposed for a new area awaiting sign-off) | at rest | no | shown |

## `auth.local_credential`

Local account password (ADR-0006 rule 2). Argon2id hash only. Scope: tenant. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Credential id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Account the password belongs to | at rest | no | shown |
| `password_hash` | confidential | Argon2id PHC string; never plaintext | at rest | no | hidden |
| `password_set_at` | internal | When the password was set | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

## `auth.auth_factor`

MFA factor: passkey (WebAuthn) or TOTP. No SMS or email codes (ADR-0006 rule 3). Scope: tenant. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Factor id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Account the factor belongs to | at rest | no | shown |
| `kind` | internal | totp or passkey | at rest | no | shown |
| `label` | internal | Name shown to the user (e.g. "Authenticator app") | at rest | no | shown |
| `totp_secret_enc` | PII | TOTP secret, AES-256-GCM envelope | field | to_verify | hidden |
| `totp_last_step` | internal | Last accepted TOTP time step (replay guard) | at rest | no | shown |
| `webauthn_credential_id` | internal | Passkey credential id (base64url) | at rest | no | shown |
| `webauthn_public_key` | internal | Passkey COSE public key | at rest | no | shown |
| `webauthn_counter` | internal | Passkey signature counter | at rest | no | shown |
| `webauthn_transports` | internal | Passkey transports hint | at rest | no | shown |
| `verified_at` | internal | When the factor was proven during enrollment | at rest | no | shown |
| `last_used_at` | internal | Last successful use | at rest | no | shown |
| `revoked_at` | internal | When the factor was revoked (MFA reset) | at rest | no | shown |
| `revoke_reason` | internal | Why the factor was revoked (code, e.g. mfa_reset) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

## `auth.login_attempt`

A sign-in between the password and the second factor (10 minutes at most). Scope: tenant. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Attempt id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Account signing in | at rest | no | shown |
| `token_hash` | confidential | SHA-256 of the pending sign-in cookie | at rest | no | hidden |
| `created_at` | internal | Start of the attempt | at rest | no | shown |
| `expires_at` | internal | End of the attempt | at rest | no | shown |
| `password_verified_at` | internal | When the password was verified | at rest | no | shown |
| `webauthn_challenge` | internal | Outstanding WebAuthn challenge | at rest | no | shown |
| `failed_mfa_count` | internal | Wrong second-factor answers in this attempt | at rest | no | shown |
| `consumed_at` | internal | When the attempt became a session | at rest | no | shown |
| `ip_address` | PII | Client IP address | at rest | no | masked |
| `user_agent` | internal | Client user agent | at rest | no | shown |

## `auth.enrollment_token`

Single-use, expiring token that allows enrolling a first MFA factor; issued by invitation or MFA reset and delivered out of band. Scope: tenant. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Token id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Account the token lets enroll | at rest | no | shown |
| `token_hash` | confidential | SHA-256 of the token | at rest | no | hidden |
| `purpose` | internal | invite or mfa_reset | at rest | no | shown |
| `created_at` | internal | When the token was issued | at rest | no | shown |
| `expires_at` | internal | When it stops working (at most 7 days) | at rest | no | shown |
| `consumed_at` | internal | When it was used to enroll | at rest | no | shown |
| `revoked_at` | internal | When it was revoked (superseded or MFA reset) | at rest | no | shown |
| `issued_by` | internal | user_account that issued it (NULL for the platform) | at rest | no | shown |

## `auth.session`

Server-side session (ADR-0006 rule 4): 15-minute idle, 12-hour absolute, one tenant, MFA required. Scope: tenant. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Session id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Signed-in account | at rest | no | shown |
| `token_hash` | confidential | SHA-256 of the session cookie | at rest | no | hidden |
| `issued_at` | internal | Sign-in time | at rest | no | shown |
| `last_seen_at` | internal | Last request (idle timeout) | at rest | no | shown |
| `absolute_expires_at` | internal | Absolute end (at most 12 hours) | at rest | no | shown |
| `idle_timeout_seconds` | internal | Idle timeout (at most 900 seconds) | at rest | no | shown |
| `mfa_method` | internal | Second factor used at sign-in | at rest | no | shown |
| `mfa_factor_id` | internal | Factor used at sign-in | at rest | no | shown |
| `mfa_at` | internal | When the second factor was verified | at rest | no | shown |
| `reauth_at` | internal | Last step-up (re-authentication) | at rest | no | shown |
| `reauth_challenge` | internal | Outstanding WebAuthn challenge for a passkey step-up | at rest | no | shown |
| `rotate_required` | internal | Token must rotate on the next request (privilege change) | at rest | no | shown |
| `rotated_at` | internal | Last token rotation | at rest | no | shown |
| `revoked_at` | internal | When the session ended | at rest | no | shown |
| `revoke_reason` | internal | logout, idle, absolute, mfa_reset, deprovisioned, admin | at rest | no | shown |
| `ip_address` | PII | Client IP address at sign-in | at rest | no | masked |
| `user_agent` | internal | Client user agent at sign-in | at rest | no | shown |

## `public.requirement_instance`

A catalog requirement applied to an organization, site, or person. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Instance id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `requirement_id` | public | Catalog requirementId | at rest | no | shown |
| `requirement_version_id` | internal | Catalog requirement version the status was computed under | at rest | no | shown |
| `subject_type` | internal | organization, site, or person | at rest | no | shown |
| `subject_id` | internal | Subject row id | at rest | no | shown |
| `site_id` | internal | Site the instance belongs to, if any | at rest | no | shown |
| `owner_person_id` | internal | Accountable person | at rest | no | shown |
| `status` | internal | met, due_soon, overdue, missing, not_applicable, not_assessed | at rest | no | shown |
| `not_applicable_reason` | PII | Required reason when status is not_applicable (free text) | at rest | no | shown |
| `next_due_on` | internal | Next due date (site or organization time zone) | at rest | no | shown |
| `status_computed_at` | internal | When the readiness engine last computed the status | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `archived_by` | internal | user_account that archived the row; always the transaction actor (set_row_meta) | at rest | no | shown |
| `archive_reason` | PII | Why the row was archived (free text) | at rest | no | shown |
| `catalog_release_id` | internal | Catalog release the status was computed under | at rest | no | shown |
| `status_reasons` | internal | Readiness engine reason codes and parameters (no free text) | at rest | no | shown |
| `not_applicable_by` | internal | user_account that marked it not applicable (database-set) | at rest | no | shown |
| `not_applicable_at` | internal | When it was marked not applicable (database-set) | at rest | no | shown |

## `public.task`

Work item, usually generated by a requirement instance. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Task id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `requirement_instance_id` | internal | Requirement instance that generated the task | at rest | no | shown |
| `site_id` | internal | Site scope | at rest | no | shown |
| `assignee_person_id` | internal | Assignee | at rest | no | shown |
| `title` | internal | Task title; must not contain personal data beyond names | at rest | no | shown |
| `due_on` | internal | Due date | at rest | no | shown |
| `status` | internal | open, in_progress, blocked, done, cancelled | at rest | no | shown |
| `completed_at` | internal | When the task was done | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `archived_by` | internal | user_account that archived the row; always the transaction actor (set_row_meta) | at rest | no | shown |
| `archive_reason` | PII | Why the row was archived (free text) | at rest | no | shown |

## `public.approval`

A human approval or rejection. Insert-only; AI never approves. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Approval id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `task_id` | internal | Task the decision closes, if any | at rest | no | shown |
| `subject_type` | internal | Kind of record approved | at rest | no | shown |
| `subject_id` | internal | Record approved | at rest | no | shown |
| `approver_person_id` | internal | Approving person | at rest | no | shown |
| `approver_user_account_id` | internal | Approving user account; must be the transaction actor | at rest | no | shown |
| `decision` | internal | approved or rejected | at rest | no | shown |
| `comment` | PII | Approver comment (free text) | at rest | no | shown |
| `requirement_ids` | public | Catalog requirementIds the decision supports | at rest | no | shown |
| `decided_at` | internal | Decision time (UTC) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

## `public.saved_view`

A saved list view (filters, sort, columns) for one record type; private or shared with roles. Never widens access. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Saved view id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `record_type` | internal | Record type id from the registry | at rest | no | shown |
| `owner_user_account_id` | internal | user_account that owns the view | at rest | no | shown |
| `name` | internal | View name; no personal data (ADR-0014 section 4.5) | at rest | no | shown |
| `visibility` | internal | private or roles | at rest | no | shown |
| `shared_roles` | internal | Role keys the view is shared with (visibility roles) | at rest | no | shown |
| `query` | PII | Filters, sort, and search text of the view (may hold a typed name) | at rest | no | shown |
| `columns` | internal | Visible columns | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | When the view was removed | at rest | no | shown |

## `audit.action_registry`

Registered audit actions and their category. Global reference data. Scope: global. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `action` | public | <entity>.<verb> | at rest | no | shown |
| `category` | public | Audit category | at rest | no | shown |
| `description` | public | What the action records | at rest | no | shown |

## `audit.audit_event`

Append-only audit log with a per-tenant SHA-256 hash chain (ADR-0008). Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Event id (UUIDv7) | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `chain_seq` | internal | Gapless sequence within the tenant chain | at rest | no | shown |
| `occurred_at` | internal | Database time (UTC); partition key | at rest | no | shown |
| `category` | internal | auth, mutation, reveal, export, approval, permission, integration, system | at rest | no | shown |
| `action` | internal | Registered action | at rest | no | shown |
| `outcome` | internal | success, denied, failure | at rest | no | shown |
| `actor_type` | internal | user, service, integration, system, break_glass | at rest | no | shown |
| `actor_person_id` | internal | Acting person | at rest | no | shown |
| `actor_user_id` | internal | Acting user account | at rest | no | shown |
| `actor_label` | PII | Actor display name at the time of the event | at rest | no | shown |
| `on_behalf_of_id` | internal | Human on whose behalf a service acted | at rest | no | shown |
| `session_id` | internal | Session id | at rest | no | shown |
| `request_id` | internal | Correlation id | at rest | no | shown |
| `ip_address` | PII | Client IP address | at rest | no | shown |
| `user_agent` | internal | Client user agent | at rest | no | shown |
| `site_id` | internal | Site the event concerns | at rest | no | shown |
| `target_table` | internal | Table of the changed record | at rest | no | shown |
| `target_id` | internal | Id of the changed record | at rest | no | shown |
| `requirement_ids` | public | Catalog requirementIds the change touches | at rest | no | shown |
| `reason` | confidential | Required for reveals, overrides, break-glass, hard deletes | at rest | no | shown |
| `diff` | confidential | Redacted before/after; encrypted fields appear only as references | at rest | no | shown |
| `metadata` | confidential | Structured context; never PHI or SSN-shaped values | at rest | no | shown |
| `schema_version` | internal | Canonical-form version | at rest | no | shown |
| `prev_hash` | internal | row_hash of the previous event (32 zero bytes for genesis) | at rest | no | shown |
| `row_hash` | internal | SHA-256(prev_hash || canonical row) | at rest | no | shown |

## `audit.chain_head`

Latest chain position per tenant; re-derivable from audit_event. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `chain_seq` | internal | Latest chain_seq | at rest | no | shown |
| `row_hash` | internal | Latest row_hash | at rest | no | shown |
| `updated_at` | internal | When the head moved | at rest | no | shown |

## `platform.tenant`

Cross-tenant registry for platform jobs; no runtime role reads it directly. Scope: platform. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `status` | internal | active, suspended, offboarding | at rest | no | shown |
| `time_zone` | internal | Organization default time zone | at rest | no | shown |
| `is_test_record` | internal | Synthetic tenant | at rest | no | shown |
| `provisioned_at` | internal | When the tenant was provisioned | at rest | no | shown |
| `provisioned_by` | internal | Platform actor label or database user that provisioned it | at rest | no | shown |

## `platform.login_directory`

Login email to tenant for sign-in; read only through auth.resolve_login (ids only). Scope: platform. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `user_account_id` | internal | Account | at rest | no | shown |
| `email_lower` | PII | Login email, lower case | at rest | to_verify | hidden |
| `is_active` | internal | Account can sign in | at rest | no | shown |
| `updated_at` | internal | Last sync from user_account | at rest | no | shown |

## `platform.auth_throttle`

Sign-in throttle and lockout state per account or IP prefix, keyed by a SHA-256 digest. Scope: platform. Owner: `security-privacy-officer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `key_hash` | internal | SHA-256 of "account:<email>" or "ip:<prefix>" | at rest | no | shown |
| `scope` | internal | account or ip | at rest | no | shown |
| `failures` | internal | Failures in the current window | at rest | no | shown |
| `window_started_at` | internal | Start of the counting window | at rest | no | shown |
| `locked_until` | internal | Locked until this time | at rest | no | shown |
| `updated_at` | internal | Last change | at rest | no | shown |

## `platform.job`

Job queue and run record (ADR-0001): enqueued in the transaction of the change; ids only in payloads. Scope: platform. Owner: `backend-engineer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Job id | at rest | no | shown |
| `queue` | internal | Queue name, e.g. readiness.recompute | at rest | no | shown |
| `organization_id` | internal | Tenant the job runs for; NULL for platform jobs | at rest | no | shown |
| `actor_label` | internal | Job or operator label for the audit events it writes | at rest | no | shown |
| `request_id` | internal | Correlation id of the request that enqueued it | at rest | no | shown |
| `payload` | internal | Job arguments: ids and dates only, never personal data | at rest | no | shown |
| `singleton_key` | internal | Coalesces queued jobs for the same work | at rest | no | shown |
| `state` | internal | queued, active, completed, failed, superseded | at rest | no | shown |
| `attempts` | internal | Runs started | at rest | no | shown |
| `max_attempts` | internal | Runs allowed before the job fails | at rest | no | shown |
| `run_after` | internal | Not before this time (retry backoff) | at rest | no | shown |
| `locked_until` | internal | Lease of the current run; an expired lease makes it resumable | at rest | no | shown |
| `created_at` | internal | When the job was enqueued | at rest | no | shown |
| `started_at` | internal | When the latest run started | at rest | no | shown |
| `finished_at` | internal | When the job completed, failed, or was superseded | at rest | no | shown |
| `last_error_code` | internal | Stable error code of the latest failure (never a message) | at rest | no | shown |

## `catalog.database_profile`

Whether this database is production or non-production for catalog releases (ADR-0003 rule 8); set once. Scope: global. Owner: `backend-engineer`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `singleton` | internal | Always true: one row | at rest | no | shown |
| `channel` | internal | production or non_production | at rest | no | shown |
| `set_at` | internal | When the migration job set it | at rest | no | shown |
| `set_by` | internal | Label of the job that set it | at rest | no | shown |

## `catalog.catalog_release`

An immutable catalog release (ADR-0003 rule 3). Scope: global. Owner: `hrsa-regulatory-analyst`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | public | Release id | at rest | no | shown |
| `catalog_version` | public | Semver catalog version, e.g. 2026.1.0 | at rest | no | shown |
| `channel` | public | production (verified only) or non_production (all statuses) | at rest | no | shown |
| `bundle_format` | public | Bundle format version | at rest | no | shown |
| `content_hash` | public | SHA-256 of the canonical bundle content | at rest | no | shown |
| `source_register_hash` | public | SHA-256 of the canonical source register | at rest | no | shown |
| `entry_count` | public | Entries in the release | at rest | no | shown |
| `sources` | public | Source register entries the release cites | at rest | no | shown |
| `changeset` | public | added, changed, retired per requirementId | at rest | no | shown |
| `published_at` | internal | When the publish job loaded it | at rest | no | shown |
| `published_by` | internal | Publish job label | at rest | no | shown |

## `catalog.requirement`

Every requirementId ever published here; never removed or renamed (ADR-0003 rule 2). Scope: global. Owner: `hrsa-regulatory-analyst`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | public | Stable requirementId | at rest | no | shown |
| `jurisdiction` | public | federal or florida | at rest | no | shown |
| `first_release_id` | public | Release that first published it | at rest | no | shown |

## `catalog.requirement_version`

A requirement as published in one release. Production rows are verified only (constraint). Scope: global. Owner: `hrsa-regulatory-analyst`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | public | Requirement version id | at rest | no | shown |
| `catalog_release_id` | public | Release | at rest | no | shown |
| `channel` | public | Release channel (carried by a composite key) | at rest | no | shown |
| `requirement_id` | public | requirementId | at rest | no | shown |
| `status` | public | draft, verified, retired | at rest | no | shown |
| `entry_hash` | public | SHA-256 of the canonical entry | at rest | no | shown |
| `chapter` | public | Compliance Manual chapter, if any | at rest | no | shown |
| `layer` | public | requirement, best_practice, state_requirement | at rest | no | shown |
| `jurisdiction` | public | federal or florida | at rest | no | shown |
| `severity` | public | critical, high, medium, low | at rest | no | shown |
| `title` | public | Title | at rest | no | shown |
| `effective_from` | public | In effect from | at rest | no | shown |
| `effective_to` | public | In effect through | at rest | no | shown |
| `entry` | public | The compiled catalog entry | at rest | no | shown |

## `public.tenant_parameter`

A health center's value for a bounded catalog parameter (ADR-0003 rule 7), with its reason. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Parameter row id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `requirement_id` | public | Catalog requirementId that declares the parameter | at rest | no | shown |
| `parameter_key` | public | Parameter name in the catalog entry | at rest | no | shown |
| `value` | internal | The value, within the catalog bounds | at rest | no | shown |
| `reason` | PII | Why the health center chose this value (free text) | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

## `public.readiness_fact`

Dated evidence the readiness engine reads; recorded by a person or an integration, corrected by retraction. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Fact id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `requirement_instance_id` | internal | Requirement instance the fact is evidence for | at rest | no | shown |
| `kind` | internal | document, completion, expiration, approval, change | at rest | no | shown |
| `effective_on` | internal | Date of the document, completion, approval, or change | at rest | no | shown |
| `expires_on` | internal | Expiration facts: valid through this date | at rest | no | shown |
| `approval_id` | internal | Approval record, for approval facts | at rest | no | shown |
| `approval_capacity` | internal | board, committee_ratified, designated, staff | at rest | no | shown |
| `approval_decision` | internal | approved or rejected | at rest | no | shown |
| `approval_type_id` | internal | Approval type (approval-authority.md section 4) | at rest | no | shown |
| `evidence_version_id` | internal | Evidence file version (FK arrives with S6) | at rest | no | shown |
| `recorded_by_type` | internal | user, break_glass, or integration; never a service (AI) actor | at rest | no | shown |
| `recorded_at` | internal | When it was recorded (database time) | at rest | no | shown |
| `retracted_at` | internal | When it was retracted | at rest | no | shown |
| `retracted_by` | internal | user_account that retracted it | at rest | no | shown |
| `retract_reason` | PII | Why it was retracted (free text) | at rest | no | shown |
| `row_version` | internal | Optimistic concurrency version; 1 on insert, +1 on every update (set_row_meta) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

## `public.readiness_snapshot`

Internal readiness snapshot pinned to its catalog release (ADR-0003 rule 4); insert-only. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Snapshot id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `catalog_release_id` | internal | Catalog release it was computed under | at rest | no | shown |
| `catalog_version` | internal | Catalog version it was computed under | at rest | no | shown |
| `engine_version` | internal | Readiness engine version | at rest | no | shown |
| `as_of_date` | internal | Organization calendar date of the snapshot | at rest | no | shown |
| `kind` | internal | nightly or on_demand | at rest | no | shown |
| `met` | internal | Instances met | at rest | no | shown |
| `denominator` | internal | Instances counted (met, due_soon, overdue, missing) | at rest | no | shown |
| `body` | internal | Counts by chapter, site, and authority, and per-instance status codes | at rest | no | shown |
| `computed_at` | internal | When it was computed | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
