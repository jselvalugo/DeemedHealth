/**
 * Catalog releases (global, read-only) and readiness tables (tenant), migration 0010.
 * The migration is the source of truth for constraints, triggers, RLS, and grants.
 */
import {
  boolean,
  date,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { rowMeta, timestamptz } from './columns.js';

export const catalogSchema = pgSchema('catalog');

export const CATALOG_CHANNELS = ['production', 'non_production'] as const;
export type CatalogChannelName = (typeof CATALOG_CHANNELS)[number];

export const databaseProfile = catalogSchema.table('database_profile', {
  singleton: boolean('singleton').primaryKey().default(true),
  channel: text('channel', { enum: CATALOG_CHANNELS }).notNull(),
  setAt: timestamptz('set_at').notNull().defaultNow(),
  setBy: text('set_by').notNull(),
});

export const catalogRelease = catalogSchema.table('catalog_release', {
  id: uuid('id').primaryKey().defaultRandom(),
  catalogVersion: text('catalog_version').notNull(),
  channel: text('channel', { enum: CATALOG_CHANNELS }).notNull(),
  bundleFormat: smallint('bundle_format').notNull(),
  contentHash: text('content_hash').notNull(),
  sourceRegisterHash: text('source_register_hash').notNull(),
  entryCount: integer('entry_count').notNull(),
  sources: jsonb('sources').notNull(),
  changeset: jsonb('changeset').notNull(),
  publishedAt: timestamptz('published_at').notNull().defaultNow(),
  publishedBy: text('published_by').notNull(),
});

export const catalogRequirement = catalogSchema.table('requirement', {
  id: text('id').primaryKey(),
  jurisdiction: text('jurisdiction', { enum: ['federal', 'florida'] }).notNull(),
  firstReleaseId: uuid('first_release_id').notNull(),
});

export const requirementVersion = catalogSchema.table('requirement_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  catalogReleaseId: uuid('catalog_release_id').notNull(),
  channel: text('channel', { enum: CATALOG_CHANNELS }).notNull(),
  requirementId: text('requirement_id').notNull(),
  status: text('status', { enum: ['draft', 'verified', 'retired'] }).notNull(),
  entryHash: text('entry_hash').notNull(),
  chapter: smallint('chapter'),
  layer: text('layer', { enum: ['requirement', 'best_practice', 'state_requirement'] }).notNull(),
  jurisdiction: text('jurisdiction', { enum: ['federal', 'florida'] }).notNull(),
  severity: text('severity', { enum: ['critical', 'high', 'medium', 'low'] }).notNull(),
  title: text('title').notNull(),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  entry: jsonb('entry').notNull(),
});

export const tenantParameter = pgTable('tenant_parameter', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  requirementId: text('requirement_id').notNull(),
  parameterKey: text('parameter_key').notNull(),
  value: integer('value').notNull(),
  reason: text('reason').notNull(),
  rowVersion: integer('row_version').notNull().default(1),
  ...rowMeta(),
});

export const READINESS_FACT_KINDS = [
  'document',
  'completion',
  'expiration',
  'approval',
  'change',
] as const;
export const APPROVAL_CAPACITIES = ['board', 'committee_ratified', 'designated', 'staff'] as const;

export const readinessFact = pgTable('readiness_fact', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  requirementInstanceId: uuid('requirement_instance_id').notNull(),
  kind: text('kind', { enum: READINESS_FACT_KINDS }).notNull(),
  effectiveOn: date('effective_on', { mode: 'string' }).notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  approvalId: uuid('approval_id'),
  approvalCapacity: text('approval_capacity', { enum: APPROVAL_CAPACITIES }),
  approvalDecision: text('approval_decision', { enum: ['approved', 'rejected'] }),
  approvalTypeId: text('approval_type_id'),
  evidenceVersionId: uuid('evidence_version_id'),
  recordedByType: text('recorded_by_type', {
    enum: ['user', 'break_glass', 'integration'],
  }).notNull(),
  recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  retractedAt: timestamptz('retracted_at'),
  retractedBy: uuid('retracted_by'),
  retractReason: text('retract_reason'),
  rowVersion: integer('row_version').notNull().default(1),
  ...rowMeta(),
});

export const readinessSnapshot = pgTable('readiness_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  catalogReleaseId: uuid('catalog_release_id').notNull(),
  catalogVersion: text('catalog_version').notNull(),
  engineVersion: text('engine_version').notNull(),
  asOfDate: date('as_of_date', { mode: 'string' }).notNull(),
  kind: text('kind', { enum: ['nightly', 'on_demand'] }).notNull(),
  met: integer('met').notNull(),
  denominator: integer('denominator').notNull(),
  body: jsonb('body').notNull(),
  computedAt: timestamptz('computed_at').notNull().defaultNow(),
  ...rowMeta(),
});
