import { z } from 'zod';
import { MODULE_IDS, type ModuleId } from './modules.js';

/**
 * Permissions and the default role catalogue. This file is the single source:
 * `packages/ui/module-registry.ts` imports `Permission` for each page's
 * `permission` field, and the S3 policy engine imports `ROLES`.
 *
 * A permission is `<moduleId>:<verb>`:
 * - `read`      see every record in the module (within the role's site scope)
 * - `read_own`  see only records about or assigned to the signed-in person
 *               (record rules in the policy engine decide what "own" means)
 * - `write`     create, update, archive
 * - `approve`   record a human decision (Approval); never granted to a service
 * - `export`    reports, CSV/XLSX, PDF packets (audited as `export`)
 *
 * Roles are coarse and deny by default. Site scope, record rules, and the
 * auditor end date narrow them further (ADR-0006 rule 7).
 */
export const PERMISSION_VERBS = ['read', 'read_own', 'write', 'approve', 'export'] as const;
export type PermissionVerb = (typeof PERMISSION_VERBS)[number];

export type Permission = `${ModuleId}:${PermissionVerb}`;

export const PERMISSIONS: readonly Permission[] = MODULE_IDS.flatMap((m) =>
  PERMISSION_VERBS.map((v) => `${m}:${v}` as Permission),
);

export const PermissionSchema = z.custom<Permission>(
  (v) => typeof v === 'string' && (PERMISSIONS as readonly string[]).includes(v),
  'Unknown permission',
);

export function permission(module: ModuleId, verb: PermissionVerb): Permission {
  return `${module}:${verb}`;
}

function grant(modules: readonly ModuleId[], verbs: readonly PermissionVerb[]): Permission[] {
  return modules.flatMap((m) => verbs.map((v) => permission(m, v)));
}

export type RoleDefinition = {
  id: string;
  /** Exact text of the role's first column in the module map's "Default roles" table. */
  moduleMapLabel: string;
  /** i18n key for the role name (EN/ES catalogs in `packages/i18n`). */
  nameKey: string;
  permissions: readonly Permission[];
  /** Auditor: access must carry an end date, at most `maxAccessDays` after the start. */
  requiresEndDate: boolean;
  maxAccessDays: number | null;
  /** Auditor: every read is written to the audit log, not only mutations. */
  auditsEveryView: boolean;
  /**
   * Registry routes this role never opens even though its module permission covers
   * them (the module map names only some pages of the module).
   */
  excludedRoutes?: readonly string[];
};

const ALL = MODULE_IDS;

/** Module map "Default roles" table, in order. */
export const ROLES = [
  {
    id: 'executive',
    moduleMapLabel: 'Executive (CEO/COO/CFO/CMO)',
    nameKey: 'role.executive.name',
    // "All modules, read. Approvals in their area": the area is a record rule.
    permissions: grant(ALL, ['read', 'approve']),
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'compliance_officer',
    moduleMapLabel: 'Compliance officer',
    nameKey: 'role.compliance_officer.name',
    permissions: grant(ALL, ['read', 'read_own', 'write', 'approve', 'export']),
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'credentialing_coordinator',
    moduleMapLabel: 'Credentialing coordinator',
    nameKey: 'role.credentialing_coordinator.name',
    permissions: grant(
      ['providers', 'enrollment', 'screening', 'learning', 'tasks'],
      ['read', 'write'],
    ),
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'board_liaison',
    moduleMapLabel: 'Board liaison',
    nameKey: 'role.board_liaison.name',
    permissions: [
      ...grant(['governance', 'tasks'], ['read', 'write']),
      permission('readiness', 'read'),
    ],
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'board_member',
    moduleMapLabel: 'Board member',
    nameKey: 'role.board_member.name',
    // "Governance (their packets, read-only)".
    permissions: [
      ...grant(['self-service'], ['read_own', 'write']),
      permission('governance', 'read_own'),
    ],
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'qi_risk_manager',
    moduleMapLabel: 'QI / Risk manager',
    nameKey: 'role.qi_risk_manager.name',
    permissions: grant(['ftca', 'quality', 'experience', 'tasks'], ['read', 'write']),
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'finance',
    moduleMapLabel: 'Finance',
    nameKey: 'role.finance.name',
    permissions: [
      ...grant(['finance', 'contracts', 'tasks'], ['read', 'write']),
      permission('scope', 'read'),
    ],
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'staff_provider',
    moduleMapLabel: 'Staff / provider',
    nameKey: 'role.staff_provider.name',
    // "Self-Service, Learning, My tasks": own records only.
    permissions: [
      ...grant(['self-service'], ['read_own', 'write']),
      permission('learning', 'read_own'),
      permission('tasks', 'read_own'),
    ],
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
  },
  {
    id: 'auditor',
    moduleMapLabel: 'Auditor (time-boxed)',
    nameKey: 'role.auditor.name',
    // "Read-only, the evidence library, and exports. Every view is logged."
    // Read as: HRSA Readiness (which holds the evidence library) read and export.
    // Deny by default; widening it is a module-map change.
    permissions: grant(['readiness'], ['read', 'export']),
    requiresEndDate: true,
    maxAccessDays: 30,
    auditsEveryView: true,
  },
  {
    id: 'org_admin',
    moduleMapLabel: 'Health center administrator',
    nameKey: 'role.org_admin.name',
    // Decision D15: "Administration (users & roles, organization & sites, integrations,
    // support access), with no compliance module data". The requirements catalog and
    // the audit log are compliance data, so those two Administration pages are out.
    permissions: grant(['admin'], ['read', 'write']),
    requiresEndDate: false,
    maxAccessDays: null,
    auditsEveryView: false,
    excludedRoutes: ['/admin/catalog', '/admin/audit'],
  },
] as const satisfies readonly RoleDefinition[];

export type RoleId = (typeof ROLES)[number]['id'];
export const ROLE_IDS = ROLES.map((r) => r.id) as unknown as readonly [RoleId, ...RoleId[]];
export const RoleIdSchema = z.enum(ROLE_IDS);

export function getRole(id: RoleId): RoleDefinition {
  const role = ROLES.find((r) => r.id === id);
  if (!role) throw new Error(`Unknown role ${id}`);
  return role;
}

/** Union of the permissions of every role held. Deny by default. */
export function permissionsFor(roles: readonly RoleId[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((r) => getRole(r).permissions));
}

export function roleAllows(roles: readonly RoleId[], p: Permission): boolean {
  return permissionsFor(roles).has(p);
}
