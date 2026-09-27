/**
 * Tenancy names fixed by ADR-0011. Application code and tests use these
 * constants instead of spelling the names by hand.
 */

/** Transaction-local settings written by `withTenant` with `set_config(..., true)`. */
export const TENANT_SETTINGS = {
  organizationId: 'app.organization_id',
  actorId: 'app.actor_id',
  requestId: 'app.request_id',
  /** PHI tables only (ADR-0002 §5). */
  siteIds: 'app.site_ids',
  /** PHI tables only (ADR-0002 §5). */
  roles: 'app.roles',
} as const;

/** Tenant column on every tenant-owned table. */
export const TENANT_COLUMN = 'organization_id';

/** The complete list of database roles (ADR-0011 §3). */
export const DB_ROLES = {
  owner: 'app_owner',
  runtime: 'app_user',
  platform: 'app_platform',
  auditWriter: 'audit_writer',
  auditRetention: 'audit_retention',
} as const;
export type DbRole = (typeof DB_ROLES)[keyof typeof DB_ROLES];

/** Object storage prefix for a tenant's evidence files (ADR-0002 §7, ADR-0011 §4). */
export function organizationObjectPrefix(organizationId: string): string {
  return `organizations/${organizationId}/`;
}
