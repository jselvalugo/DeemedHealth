# Data dictionary: core shared entities

<!-- Generated from packages/db/src/data-dictionary.ts by `pnpm --filter @deemed/db dictionary`. Do not edit by hand. -->

Owner: `data-architect`. Classes follow `docs/security/data-classification.md`.
Every column of every table in the `public`, `audit`, and `platform` schemas is listed;
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
| `grant_reason` | confidential | Why the role was granted | at rest | no | shown |
| `revoked_at` | internal | When the grant was revoked | at rest | no | shown |
| `revoked_by` | internal | Who revoked it (NULL for a service actor) | at rest | no | shown |
| `revoke_reason` | confidential | Why the grant was revoked | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

## `public.requirement_instance`

A catalog requirement applied to an organization, site, or person. Scope: tenant. Owner: `data-architect`.

| Column | Class | Description | Encryption | FIPA PI | Display |
| --- | --- | --- | --- | --- | --- |
| `id` | internal | Instance id | at rest | no | shown |
| `organization_id` | internal | Tenant (organization) that owns the row; RLS key | at rest | no | shown |
| `requirement_id` | public | Catalog requirementId | at rest | no | shown |
| `requirement_version_id` | internal | Catalog requirement version (FK arrives with the catalog tables) | at rest | no | shown |
| `subject_type` | internal | organization, site, or person | at rest | no | shown |
| `subject_id` | internal | Subject row id | at rest | no | shown |
| `site_id` | internal | Site the instance belongs to, if any | at rest | no | shown |
| `owner_person_id` | internal | Accountable person | at rest | no | shown |
| `status` | internal | met, due_soon, overdue, missing, not_applicable | at rest | no | shown |
| `not_applicable_reason` | confidential | Required reason when status is not_applicable | at rest | no | shown |
| `next_due_on` | internal | Next due date (site or organization time zone) | at rest | no | shown |
| `status_computed_at` | internal | When the readiness engine last computed the status | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |
| `archived_at` | internal | Soft-delete time; archived rows are hidden, never hard-deleted | at rest | no | shown |

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
| `comment` | confidential | Approver comment | at rest | no | shown |
| `requirement_ids` | public | Catalog requirementIds the decision supports | at rest | no | shown |
| `decided_at` | internal | Decision time (UTC) | at rest | no | shown |
| `created_at` | internal | When the row was created (UTC), set by the database | at rest | no | shown |
| `created_by` | internal | user_account that created the row, from the transaction actor | at rest | no | shown |
| `updated_at` | internal | When the row last changed (UTC), set by the database | at rest | no | shown |
| `updated_by` | internal | user_account that last changed the row | at rest | no | shown |

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
