import { describe, expect, it } from 'vitest';
import { ROLES, type Permission, type RoleId } from '../permissions.js';
import { APPROVAL_AREAS, isSnakeKey } from './approval-areas.js';
import {
  activeGrants,
  activeRoleIds,
  auditsEveryView,
  authorize,
  effectivePermissions,
  grantInactiveReason,
  navigationFor,
  siteScope,
  type PolicyContext,
  type Principal,
  type RoleGrant,
} from './policy.js';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const S1 = '00000000-0000-4000-8000-000000000011';
const S2 = '00000000-0000-4000-8000-000000000022';
const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';

// A fake clock: every check below passes an explicit "now".
const T0 = new Date('2026-09-27T12:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(T0.getTime() + days * DAY);

let n = 0;
function grant(roleId: string, extra: Partial<RoleGrant> = {}): RoleGrant {
  n += 1;
  return {
    id: `grant-${n}`,
    roleId,
    siteId: null,
    validFrom: at(-1),
    expiresAt: null,
    ...extra,
  };
}

function principal(...grants: RoleGrant[]): Principal {
  return { organizationId: ORG, userAccountId: 'u', personId: ME, grants };
}

const ctx = (now = T0): PolicyContext => ({ now, approvalAreas: APPROVAL_AREAS });
const record = (siteId: string | null, owners?: string[]) => ({
  organizationId: ORG,
  siteId,
  ...(owners ? { ownerPersonIds: owners } : {}),
});

describe('grants', () => {
  it('ignore unknown roles, future, expired, and revoked grants (deny by default)', () => {
    expect(grantInactiveReason(grant('ghost_role'), T0)).toBe('unknown_role');
    expect(grantInactiveReason(grant('finance', { validFrom: at(1) }), T0)).toBe('not_started');
    expect(grantInactiveReason(grant('finance', { expiresAt: T0 }), T0)).toBe('expired');
    expect(grantInactiveReason(grant('finance', { revokedAt: at(-0.5) }), T0)).toBe('revoked');
    expect(grantInactiveReason(grant('finance'), T0)).toBeNull();
    expect(authorize(principal(), 'command-center:read', undefined, ctx())).toEqual({
      allowed: false,
      reason: 'no_active_role',
    });
    expect(authorize(principal(grant('ghost_role')), 'admin:read', undefined, ctx())).toEqual({
      allowed: false,
      reason: 'no_active_role',
    });
  });

  it('require an auditor end date of at most 30 days', () => {
    const noEnd = grant('auditor');
    const tooLong = grant('auditor', { validFrom: at(-1), expiresAt: at(30) });
    const ok = grant('auditor', { validFrom: at(-1), expiresAt: at(29) });
    expect(grantInactiveReason(noEnd, T0)).toBe('end_date_invalid');
    expect(grantInactiveReason(tooLong, T0)).toBe('end_date_invalid');
    expect(grantInactiveReason(ok, T0)).toBeNull();
  });

  it('deny the auditor after the end date (fake clock)', () => {
    const p = principal(grant('auditor', { validFrom: T0, expiresAt: at(14) }));
    expect(authorize(p, 'readiness:read', record(null), ctx(at(13.99))).allowed).toBe(true);
    expect(authorize(p, 'readiness:read', record(null), ctx(at(14)))).toEqual({
      allowed: false,
      reason: 'no_active_role',
    });
    expect(auditsEveryView(p, at(1))).toBe(true);
    expect(auditsEveryView(p, at(15))).toBe(false);
  });

  it('report active roles in module-map order and the site scope', () => {
    const p = principal(
      grant('staff_provider', { siteId: S1 }),
      grant('credentialing_coordinator', { siteId: S2 }),
    );
    expect(activeRoleIds(p, T0)).toEqual(['credentialing_coordinator', 'staff_provider']);
    expect(siteScope(p, T0)).toEqual([S1, S2]);
    expect(siteScope(principal(grant('finance')), T0)).toBeNull();
    expect(activeGrants(p, T0)).toHaveLength(2);
  });
});

describe('authorize', () => {
  it('denies another organization’s record whatever the role', () => {
    const p = principal(grant('compliance_officer'));
    expect(
      authorize(p, 'readiness:read', { organizationId: OTHER_ORG, siteId: null }, ctx()),
    ).toEqual({ allowed: false, reason: 'tenant' });
  });

  it('limits site-scoped grants to their site; org-wide records need an org-wide grant', () => {
    const p = principal(grant('credentialing_coordinator', { siteId: S1 }));
    expect(authorize(p, 'providers:write', record(S1), ctx()).allowed).toBe(true);
    expect(authorize(p, 'providers:write', record(S2), ctx())).toEqual({
      allowed: false,
      reason: 'site_scope',
    });
    expect(authorize(p, 'providers:read', record(null), ctx())).toEqual({
      allowed: false,
      reason: 'site_scope',
    });
    // Page-level (navigation) checks ignore the site.
    expect(authorize(p, 'providers:read', undefined, ctx()).allowed).toBe(true);
  });

  it('lets read_own read only the principal’s own records', () => {
    const p = principal(grant('staff_provider', { siteId: S1 }));
    expect(authorize(p, 'tasks:read', record(S1, [ME]), ctx()).allowed).toBe(true);
    expect(authorize(p, 'tasks:read_own', record(S1, [ME]), ctx()).allowed).toBe(true);
    expect(authorize(p, 'tasks:read', record(S1, [SOMEONE]), ctx())).toEqual({
      allowed: false,
      reason: 'record_rule',
    });
    expect(authorize(p, 'tasks:read', record(S1), ctx())).toEqual({
      allowed: false,
      reason: 'record_rule',
    });
    expect(authorize(p, 'tasks:write', record(S1, [ME]), ctx())).toEqual({
      allowed: false,
      reason: 'permission',
    });
  });

  it('limits executive approvals to the approval area of the grant (data-driven)', () => {
    const cfo = principal(grant('executive', { approvalArea: 'finance' }));
    expect(authorize(cfo, 'finance:approve', record(null), ctx()).allowed).toBe(true);
    expect(authorize(cfo, 'providers:approve', record(null), ctx())).toEqual({
      allowed: false,
      reason: 'approval_area',
    });
    // Executives still read everything.
    expect(authorize(cfo, 'providers:read', record(null), ctx()).allowed).toBe(true);
    // No area: approves nothing.
    const noArea = principal(grant('executive'));
    expect(authorize(noArea, 'finance:approve', record(null), ctx())).toEqual({
      allowed: false,
      reason: 'approval_area',
    });
    // A different mapping (as loaded from the database) changes the outcome, not the code.
    const custom: PolicyContext = { now: T0, approvalAreas: { finance: ['providers'] } };
    expect(authorize(cfo, 'providers:approve', record(null), custom).allowed).toBe(true);
    // The compliance officer is not area-limited.
    const co = principal(grant('compliance_officer'));
    expect(authorize(co, 'providers:approve', record(S2), ctx()).allowed).toBe(true);
  });

  // One row per role: a permission it has and one it lacks (module map "Default roles").
  const perRole: [RoleId, Permission, Permission][] = [
    ['executive', 'governance:read', 'governance:write'],
    ['compliance_officer', 'admin:write', 'admin:write'],
    ['credentialing_coordinator', 'screening:write', 'admin:read'],
    ['board_liaison', 'readiness:read', 'readiness:write'],
    ['board_member', 'governance:read_own', 'governance:write'],
    ['qi_risk_manager', 'ftca:write', 'finance:read'],
    ['finance', 'scope:read', 'scope:write'],
    ['staff_provider', 'learning:read_own', 'learning:write'],
    ['auditor', 'readiness:export', 'readiness:write'],
    ['org_admin', 'admin:write', 'readiness:read'],
  ];
  it.each(perRole)('%s: allows %s, denies %s', (role, yes, no) => {
    const end = role === 'auditor' ? { expiresAt: at(10) } : {};
    const p = principal(grant(role, end));
    expect(authorize(p, yes, undefined, ctx()).allowed).toBe(true);
    if (role !== 'compliance_officer') {
      expect(authorize(p, no, undefined, ctx())).toEqual({ allowed: false, reason: 'permission' });
    }
  });

  it('covers every role in the catalogue', () => {
    expect(perRole.map((r) => r[0]).sort()).toEqual(ROLES.map((r) => r.id).sort());
  });
});

describe('navigationFor', () => {
  const modules = [
    {
      id: 'tasks' as const,
      status: 'mvp',
      pages: [
        { id: 'mine', route: '/tasks', permission: 'tasks:read_own' as Permission },
        { id: 'team', route: '/tasks/team', permission: 'tasks:read' as Permission },
      ],
    },
    {
      id: 'admin' as const,
      status: 'mvp',
      pages: [{ id: 'users', route: '/admin/users', permission: 'admin:read' as Permission }],
    },
    {
      id: 'quality' as const,
      status: 'planned',
      pages: [{ id: 'q', route: '/quality', permission: 'quality:read' as Permission }],
    },
  ];

  it('shows only permitted pages and modules, never planned ones', () => {
    const staff = principal(grant('staff_provider'));
    expect(navigationFor(staff, modules, T0).map((m) => [m.id, m.pages.map((p) => p.id)])).toEqual([
      ['tasks', ['mine']],
    ]);
    const co = principal(grant('compliance_officer'));
    expect(navigationFor(co, modules, T0).map((m) => m.id)).toEqual(['tasks', 'admin']);
    expect(navigationFor(principal(), modules, T0)).toEqual([]);
  });

  it('shows the health center administrator only the Administration pages D15 names', () => {
    const adminModule = {
      id: 'admin' as const,
      status: 'mvp',
      pages: [
        '/admin/users',
        '/admin/org',
        '/admin/integrations',
        '/admin/catalog',
        '/admin/audit',
        '/admin/support-access',
      ].map((route) => ({ id: route, route, permission: 'admin:read' as Permission })),
    };
    const orgAdmin = principal(grant('org_admin'));
    expect(
      navigationFor(orgAdmin, [adminModule], T0).map((m) => [m.id, m.pages.map((p) => p.route)]),
    ).toEqual([
      ['admin', ['/admin/users', '/admin/org', '/admin/integrations', '/admin/support-access']],
    ]);
    // Another role that holds admin:read still sees every page.
    const both = principal(grant('org_admin'), grant('compliance_officer'));
    expect(navigationFor(both, [adminModule], T0)[0]?.pages).toHaveLength(6);
  });

  it('follows the clock: an expired grant empties the launcher', () => {
    const p = principal(grant('compliance_officer', { expiresAt: at(1) }));
    expect(navigationFor(p, modules, at(0.5))).toHaveLength(2);
    expect(navigationFor(p, modules, at(2))).toEqual([]);
    expect(effectivePermissions(p, at(2)).size).toBe(0);
  });
});

describe('approval areas', () => {
  it('use snake_case keys and known modules', () => {
    for (const key of Object.keys(APPROVAL_AREAS)) expect(isSnakeKey(key)).toBe(true);
    expect(isSnakeKey('Bad-Key')).toBe(false);
    expect(isSnakeKey('')).toBe(false);
    expect(isSnakeKey('9lives')).toBe(false);
  });
});
