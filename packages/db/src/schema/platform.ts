/**
 * Platform schema: the cross-tenant tenant registry. No runtime role reads it
 * directly; app_platform uses platform.list_tenants() and
 * platform.provision_organization() (ADR-0002 section 3).
 */
import { boolean, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { FLORIDA_TIME_ZONES } from './core.js';

export const platformSchema = pgSchema('platform');

export const tenant = platformSchema.table('tenant', {
  organizationId: uuid('organization_id').primaryKey(),
  status: text('status', { enum: ['active', 'suspended', 'offboarding'] })
    .notNull()
    .default('active'),
  timeZone: text('time_zone', { enum: FLORIDA_TIME_ZONES }).notNull(),
  isTestRecord: boolean('is_test_record').notNull(),
  provisionedAt: timestamptz('provisioned_at').notNull().defaultNow(),
  provisionedBy: text('provisioned_by').notNull(),
});
