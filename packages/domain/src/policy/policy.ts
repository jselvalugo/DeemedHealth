/**
 * RBAC policy engine (ADR-0006 rule 7, phase-1 plan S3). Pure: no I/O, no clock of
 * its own. The API loads the principal (role grants from `public.role_assignment`)
 * and the approval-area mapping (`public.approval_area`), passes `now` from its
 * injected clock, and asks `authorize()` before every read or write.
 *
 * Rules, in order:
 *  1. Deny by default. Unknown role ids, grants not yet valid, expired or revoked
 *     grants, and grants of an end-dated role (auditor) without a valid end date
 *     count for nothing.
 *  2. Tenant: a record of another organization is always denied.
 *  3. Permission: some active grant's role must hold the permission. `read` implies
 *     `read_own`; a grant with only `read_own` reads only records the principal owns.
 *  4. Site scope: a grant limited to a site covers records of that site only. An
 *     organization-wide record (siteId null) needs an organization-wide grant.
 *  5. Record rules: `read_own` needs ownership; an executive's `approve` needs a grant
 *     whose approval area covers the record's module.
 */
import type { ModuleId } from '../modules.js';
import {
  ROLES,
  type Permission,
  type PermissionVerb,
  type RoleDefinition,
  type RoleId,
} from '../permissions.js';
import type { ApprovalAreas } from './approval-areas.js';

/** One row of `role_assignment`, as the policy sees it. */
export interface RoleGrant {
  id: string;
  /** Role key. Keys missing from ROLES (the module map) grant nothing. */
  roleId: string;
  /** null: all sites of the organization. */
  siteId: string | null;
  validFrom: Date;
  expiresAt: Date | null;
  revokedAt?: Date | null;
  /** Executive grants only: key into the approval-area mapping. */
  approvalArea?: string | null;
}

export interface Principal {
  organizationId: string;
  userAccountId: string;
  personId: string;
  grants: readonly RoleGrant[];
}

export interface PolicyContext {
  now: Date;
  approvalAreas: ApprovalAreas;
}

/** The record being acted on. Omit it entirely for page- or module-level checks. */
export interface ResourceRef {
  organizationId: string;
  /** Site of the record; null for an organization-wide record. */
  siteId: string | null;
  /** People the record is about or assigned to (for `read_own`). */
  ownerPersonIds?: readonly string[];
}

export type DenyReason =
  'no_active_role' | 'permission' | 'tenant' | 'site_scope' | 'record_rule' | 'approval_area';

export type Decision =
  { allowed: true; grantIds: readonly string[] } | { allowed: false; reason: DenyReason };

/** Roles whose `approve` is limited to their approval area (module map: Executive). */
export const AREA_LIMITED_APPROVAL_ROLES: readonly RoleId[] = ['executive'];

const ROLE_BY_ID = new Map<string, RoleDefinition>(ROLES.map((r) => [r.id, r]));
const DAY_MS = 86_400_000;

function splitPermission(p: Permission): [ModuleId, PermissionVerb] {
  const i = p.indexOf(':');
  return [p.slice(0, i) as ModuleId, p.slice(i + 1) as PermissionVerb];
}

/** Why a single grant does not count right now, or null when it is active. */
export function grantInactiveReason(
  grant: RoleGrant,
  now: Date,
): null | 'unknown_role' | 'not_started' | 'expired' | 'revoked' | 'end_date_invalid' {
  const role = ROLE_BY_ID.get(grant.roleId);
  if (!role) return 'unknown_role';
  if (grant.revokedAt && grant.revokedAt.getTime() <= now.getTime()) return 'revoked';
  if (grant.validFrom.getTime() > now.getTime()) return 'not_started';
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (role.requiresEndDate) {
    // Auditor: an end date is mandatory and at most maxAccessDays after the start.
    if (!grant.expiresAt) return 'end_date_invalid';
    const max = (role.maxAccessDays ?? 0) * DAY_MS;
    if (grant.expiresAt.getTime() - grant.validFrom.getTime() > max) return 'end_date_invalid';
  }
  return null;
}

export function activeGrants(principal: Principal, now: Date): RoleGrant[] {
  return principal.grants.filter((g) => grantInactiveReason(g, now) === null);
}

function roleOf(grant: RoleGrant): RoleDefinition {
  return ROLE_BY_ID.get(grant.roleId) as RoleDefinition;
}

/** Every permission the principal holds through at least one active grant (any site). */
export function effectivePermissions(principal: Principal, now: Date): ReadonlySet<Permission> {
  return new Set(activeGrants(principal, now).flatMap((g) => roleOf(g).permissions));
}

/** Active role ids, without duplicates, in ROLES order. */
export function activeRoleIds(principal: Principal, now: Date): RoleId[] {
  const held = new Set(activeGrants(principal, now).map((g) => g.roleId));
  return ROLES.filter((r) => held.has(r.id)).map((r) => r.id);
}

/** Auditor-style roles: every read is written to the audit log (module map). */
export function auditsEveryView(principal: Principal, now: Date): boolean {
  return activeGrants(principal, now).some((g) => roleOf(g).auditsEveryView);
}

/** Site ids the principal is limited to, or null when some active grant covers all sites. */
export function siteScope(principal: Principal, now: Date): readonly string[] | null {
  const grants = activeGrants(principal, now);
  if (grants.some((g) => g.siteId === null)) return null;
  return [...new Set(grants.map((g) => g.siteId as string))];
}

function siteCovers(grant: RoleGrant, resource: ResourceRef): boolean {
  if (grant.siteId === null) return true;
  return resource.siteId !== null && resource.siteId === grant.siteId;
}

export function authorize(
  principal: Principal,
  permission: Permission,
  resource: ResourceRef | undefined,
  ctx: PolicyContext,
): Decision {
  if (resource && resource.organizationId !== principal.organizationId) {
    return { allowed: false, reason: 'tenant' };
  }
  const grants = activeGrants(principal, ctx.now);
  if (grants.length === 0) return { allowed: false, reason: 'no_active_role' };

  const [module, verb] = splitPermission(permission);
  const reading = verb === 'read' || verb === 'read_own';
  const fullPermission: Permission = reading ? `${module}:read` : permission;
  const full = grants.filter((g) => roleOf(g).permissions.includes(fullPermission));
  const own = reading
    ? grants.filter(
        (g) => !full.includes(g) && roleOf(g).permissions.includes(`${module}:read_own`),
      )
    : [];
  if (full.length === 0 && own.length === 0) return { allowed: false, reason: 'permission' };

  // Page- or module-level check (navigation): holding the permission is enough.
  if (!resource) return { allowed: true, grantIds: [...full, ...own].map((g) => g.id) };

  let reason: DenyReason = 'site_scope';
  const allowedBy: string[] = [];
  for (const g of full) {
    if (!siteCovers(g, resource)) continue;
    if (verb === 'approve' && AREA_LIMITED_APPROVAL_ROLES.includes(g.roleId as RoleId)) {
      const modules = g.approvalArea ? ctx.approvalAreas[g.approvalArea] : undefined;
      if (!modules?.includes(module)) {
        reason = 'approval_area';
        continue;
      }
    }
    allowedBy.push(g.id);
  }
  for (const g of own) {
    if (!siteCovers(g, resource)) continue;
    if (!resource.ownerPersonIds?.includes(principal.personId)) {
      if (reason === 'site_scope') reason = 'record_rule';
      continue;
    }
    allowedBy.push(g.id);
  }
  return allowedBy.length > 0 ? { allowed: true, grantIds: allowedBy } : { allowed: false, reason };
}

/** Sites a set of grants covers: every site (`all`), or the listed ones. */
export interface SiteCoverage {
  all: boolean;
  sites: readonly string[];
}

/**
 * Where a permission applies, for compiling list queries to SQL (ADR-0014 section 2.2,
 * "scope before paging"). Same grant logic as `authorize()`:
 *  - `full`: grants that hold the permission (for reads, `read`); a record is covered
 *    when one of its sites is listed, or when `all` is set (including organization-wide
 *    records, which only an organization-wide grant covers);
 *  - `own`: reads only, grants with nothing but `read_own`; they cover a record only when
 *    it is about or assigned to the principal.
 * The approval-area rule applies to `approve`, which lists never use.
 */
export interface PermissionScope {
  full: SiteCoverage;
  own: SiteCoverage;
}

export function permissionScope(
  principal: Principal,
  permission: Permission,
  now: Date,
): PermissionScope {
  const grants = activeGrants(principal, now);
  const [module, verb] = splitPermission(permission);
  const reading = verb === 'read' || verb === 'read_own';
  const fullPermission: Permission = reading ? `${module}:read` : permission;
  const full = grants.filter((g) => roleOf(g).permissions.includes(fullPermission));
  const own = reading
    ? grants.filter(
        (g) => !full.includes(g) && roleOf(g).permissions.includes(`${module}:read_own`),
      )
    : [];
  const coverage = (gs: RoleGrant[]): SiteCoverage => ({
    all: gs.some((g) => g.siteId === null),
    sites: [...new Set(gs.flatMap((g) => (g.siteId === null ? [] : [g.siteId])))],
  });
  return { full: coverage(full), own: coverage(own) };
}

/** Structural shape of a module registry entry (packages/ui/module-registry.ts). */
export interface NavigablePage {
  id: string;
  route: string;
  permission: Permission;
}
export interface NavigableModule<P extends NavigablePage = NavigablePage> {
  id: ModuleId;
  status: string;
  pages: readonly P[];
}

/** Registry statuses shown in the launcher (the registry's LAUNCHER_STATUSES). */
export const NAVIGATION_STATUSES: readonly string[] = ['mvp', 'next'];

/** Whether a page is navigable with these permissions (`read` implies `read_own`). */
export function pageAllowed(page: NavigablePage, permissions: ReadonlySet<Permission>): boolean {
  if (permissions.has(page.permission)) return true;
  const [module, verb] = splitPermission(page.permission);
  return verb === 'read_own' && permissions.has(`${module}:read`);
}

/**
 * The launcher for this principal: registry modules in order, each with only the
 * pages the policy allows; modules with no allowed page are left out.
 */
export function navigationFor<P extends NavigablePage, M extends NavigableModule<P>>(
  principal: Principal,
  modules: readonly M[],
  now: Date,
): { id: ModuleId; pages: P[] }[] {
  // Per grant: a role's module permission opens a page unless the role excludes it.
  const roles = activeGrants(principal, now).map(roleOf);
  const allowed = (page: P) =>
    roles.some(
      (role) =>
        pageAllowed(page, new Set(role.permissions)) && !role.excludedRoutes?.includes(page.route),
    );
  return modules
    .filter((m) => NAVIGATION_STATUSES.includes(m.status))
    .map((m) => ({ id: m.id, pages: m.pages.filter(allowed) }))
    .filter((m) => m.pages.length > 0);
}
