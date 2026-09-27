// Placeholder for @deemed/api. Real code arrives in Phase 1 (see ADR-0001).
import { DB_ROLES, type Permission } from '@deemed/domain';

export const packageName = '@deemed/api';

/** The API connects only as the runtime role (ADR-0011). */
export const runtimeDbRole = DB_ROLES.runtime;

/** Route manifest entries (S3) name the permission they require. */
export type RoutePermission = Permission;
