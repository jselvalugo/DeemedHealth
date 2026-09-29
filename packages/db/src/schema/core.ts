/**
 * Core shared entities (Phase 1, slice S2). The SQL migrations in ../../migrations are
 * the source of truth for constraints, RLS policies, grants, and triggers; this file
 * mirrors their columns for typed queries. A test compares the two column by column.
 *
 * Every tenant table has organization_id NOT NULL and forced RLS (ADR-0002, ADR-0011).
 * No SSN column exists anywhere (decision D1).
 */
import { boolean, date, integer, interval, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { archiveMeta, bytea, rowMeta, timestamptz } from './columns.js';

export const AWARD_TYPES = ['section330', 'lookalike'] as const;
export type AwardType = (typeof AWARD_TYPES)[number];

export const SUB_PROGRAMS = ['CHC', 'MHC', 'HCH', 'PHPC'] as const;
export type SubProgram = (typeof SUB_PROGRAMS)[number];

/** Florida has two time zones: Eastern, and Central for the western Panhandle. */
export const FLORIDA_TIME_ZONES = ['America/New_York', 'America/Chicago'] as const;
export type FloridaTimeZone = (typeof FLORIDA_TIME_ZONES)[number];

export const SITE_TYPES = [
  'service_delivery',
  'administrative',
  'mobile',
  'intermittent',
  'seasonal',
  'other',
] as const;

export const USER_ACCOUNT_STATUSES = ['invited', 'active', 'suspended', 'deprovisioned'] as const;

export const REQUIREMENT_STATUSES = [
  'met',
  'due_soon',
  'overdue',
  'missing',
  'not_applicable',
  'not_assessed',
] as const;

export const REQUIREMENT_SUBJECT_TYPES = ['organization', 'site', 'person'] as const;

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;

export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  awardType: text('award_type', { enum: AWARD_TYPES }).notNull(),
  subPrograms: text('sub_programs', { enum: SUB_PROGRAMS }).array().notNull().default([]),
  grantNumber: text('grant_number'),
  npi: text('npi'),
  timeZone: text('time_zone', { enum: FLORIDA_TIME_ZONES }).notNull(),
  isPublicAgency: boolean('is_public_agency').notNull().default(false),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text('city').notNull(),
  state: text('state', { enum: ['FL'] })
    .notNull()
    .default('FL'),
  postalCode: text('postal_code').notNull(),
  isTestRecord: boolean('is_test_record').notNull().default(false),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
  ...archiveMeta(),
});

export const site = pgTable('site', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  name: text('name').notNull(),
  form5bSiteId: text('form_5b_site_id'),
  siteType: text('site_type', { enum: SITE_TYPES }).notNull().default('service_delivery'),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text('city').notNull(),
  state: text('state', { enum: ['FL'] })
    .notNull()
    .default('FL'),
  postalCode: text('postal_code').notNull(),
  timeZone: text('time_zone', { enum: FLORIDA_TIME_ZONES }).notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull().defaultNow(),
  validTo: date('valid_to', { mode: 'string' }),
  isTestRecord: boolean('is_test_record').notNull().default(false),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
  ...archiveMeta(),
});

export const person = pgTable('person', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  preferredName: text('preferred_name'),
  workEmail: text('work_email'),
  /** Field-encrypted (ADR-0007). Never written in clear text. */
  dobEnc: bytea('dob_enc'),
  /** Keyed HMAC blind index of the DOB, for screening matches. */
  dobBidx: bytea('dob_bidx'),
  /** Field-encrypted (ADR-0007). */
  homeAddressEnc: bytea('home_address_enc'),
  npi: text('npi'),
  isTestRecord: boolean('is_test_record').notNull().default(false),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
  ...archiveMeta(),
});

export const userAccount = pgTable('user_account', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  personId: uuid('person_id').notNull(),
  idpIssuer: text('idp_issuer').notNull(),
  idpSubject: text('idp_subject').notNull(),
  loginEmail: text('login_email').notNull(),
  status: text('status', { enum: USER_ACCOUNT_STATUSES }).notNull().default('invited'),
  mfaEnrolledAt: timestamptz('mfa_enrolled_at'),
  lastLoginAt: timestamptz('last_login_at'),
  isTestRecord: boolean('is_test_record').notNull().default(false),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
  ...archiveMeta(),
});

/** Global reference data (no organization_id); read-only to app_user. */
export const role = pgTable('role', {
  key: text('key').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  descriptionEn: text('description_en').notNull(),
  isReadOnly: boolean('is_read_only').notNull().default(false),
  requiresExpiry: boolean('requires_expiry').notNull().default(false),
  maxDuration: interval('max_duration'),
});

/** site_id NULL means all sites. Never edited in place: revoke and grant anew. */
export const roleAssignment = pgTable('role_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  userAccountId: uuid('user_account_id').notNull(),
  roleKey: text('role_key')
    .notNull()
    .references(() => role.key),
  siteId: uuid('site_id'),
  validFrom: timestamptz('valid_from').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at'),
  grantReason: text('grant_reason'),
  revokedAt: timestamptz('revoked_at'),
  revokedBy: uuid('revoked_by'),
  revokeReason: text('revoke_reason'),
  ...rowMeta(),
  /** Executive grants only: the approval area (public.approval_area). */
  approvalArea: text('approval_area'),
  rowVersion: integer('row_version').notNull().default(1),
});

/** Global reference data: executive approval areas (confirmed, decision D16). */
export const approvalArea = pgTable('approval_area', {
  key: text('key').primaryKey(),
  modules: text('modules').array().notNull(),
  descriptionEn: text('description_en').notNull(),
  status: text('status', { enum: ['proposed', 'confirmed'] })
    .notNull()
    .default('proposed'),
});

export const requirementInstance = pgTable('requirement_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  requirementId: text('requirement_id').notNull(),
  requirementVersionId: uuid('requirement_version_id'),
  subjectType: text('subject_type', { enum: REQUIREMENT_SUBJECT_TYPES }).notNull(),
  subjectId: uuid('subject_id').notNull(),
  siteId: uuid('site_id'),
  ownerPersonId: uuid('owner_person_id'),
  status: text('status', { enum: REQUIREMENT_STATUSES }).notNull().default('missing'),
  notApplicableReason: text('not_applicable_reason'),
  nextDueOn: date('next_due_on', { mode: 'string' }),
  statusComputedAt: timestamptz('status_computed_at'),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
  ...archiveMeta(),
  /** Catalog release the status was computed under (migration 0010). */
  catalogReleaseId: uuid('catalog_release_id'),
  /** Engine reason codes and parameters (no free text). */
  statusReasons: jsonb('status_reasons').notNull().default([]),
  /** Set by the database from the human actor who marked it not applicable. */
  notApplicableBy: uuid('not_applicable_by'),
  notApplicableAt: timestamptz('not_applicable_at'),
  /** Set by the recompute job when the catalog no longer allows the mark (kept for review). */
  notApplicableSupersededAt: timestamptz('not_applicable_superseded_at'),
  notApplicableSupersededCatalogVersion: text('not_applicable_superseded_catalog_version'),
});

export const task = pgTable('task', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  requirementInstanceId: uuid('requirement_instance_id'),
  siteId: uuid('site_id'),
  assigneePersonId: uuid('assignee_person_id'),
  title: text('title').notNull(),
  dueOn: date('due_on', { mode: 'string' }),
  status: text('status', { enum: TASK_STATUSES }).notNull().default('open'),
  completedAt: timestamptz('completed_at'),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
  ...archiveMeta(),
});

/** Insert-only for app_user. Recorded by the approving human in their own session. */
export const approval = pgTable('approval', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  taskId: uuid('task_id'),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  approverPersonId: uuid('approver_person_id').notNull(),
  approverUserAccountId: uuid('approver_user_account_id').notNull(),
  decision: text('decision', { enum: APPROVAL_DECISIONS }).notNull(),
  comment: text('comment'),
  requirementIds: text('requirement_ids').array().notNull().default([]),
  decidedAt: timestamptz('decided_at').notNull().defaultNow(),
  ...rowMeta(),
});

export const SAVED_VIEW_VISIBILITIES = ['private', 'roles'] as const;

/** A list view for one record type (ADR-0014 section 6); never widens access. */
export const savedView = pgTable('saved_view', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  recordType: text('record_type').notNull(),
  ownerUserAccountId: uuid('owner_user_account_id').notNull(),
  name: text('name').notNull(),
  visibility: text('visibility', { enum: SAVED_VIEW_VISIBILITIES }).notNull().default('private'),
  sharedRoles: text('shared_roles').array().notNull().default([]),
  query: jsonb('query').notNull().default({}),
  columns: text('columns').array().notNull().default([]),
  rowVersion: integer('row_version').notNull().default(1),
  ...rowMeta(),
  archivedAt: timestamptz('archived_at'),
});
