/**
 * Platform schema: the cross-tenant tenant registry. No runtime role reads it
 * directly; app_platform uses platform.list_tenants() and
 * platform.provision_organization() (ADR-0002 section 3).
 */
import { boolean, integer, pgSchema, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, timestamptz } from './columns.js';
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

/** Login email to tenant, maintained by a trigger on user_account (migration 0004). */
export const loginDirectory = platformSchema.table(
  'login_directory',
  {
    organizationId: uuid('organization_id').notNull(),
    userAccountId: uuid('user_account_id').notNull(),
    emailLower: text('email_lower').notNull(),
    isActive: boolean('is_active').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userAccountId] })],
);

/** Sign-in throttle state keyed by a SHA-256 of the account or IP prefix (migration 0004). */
export const authThrottle = platformSchema.table('auth_throttle', {
  keyHash: bytea('key_hash').primaryKey(),
  scope: text('scope', { enum: ['account', 'ip'] }).notNull(),
  failures: integer('failures').notNull(),
  windowStartedAt: timestamptz('window_started_at').notNull(),
  lockedUntil: timestamptz('locked_until'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
