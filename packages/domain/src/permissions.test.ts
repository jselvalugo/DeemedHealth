import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODULES } from './modules.js';
import {
  PERMISSIONS,
  PermissionSchema,
  permissionsFor,
  ROLES,
  roleAllows,
  type RoleId,
} from './permissions.js';

const moduleMap = readFileSync(
  new URL('../../../docs/product/module-map.md', import.meta.url),
  'utf8',
);

/** Rows of the markdown table that follows `heading`. */
function tableRows(heading: string): string[][] {
  const start = moduleMap.indexOf(heading);
  expect(start, `heading ${heading}`).toBeGreaterThanOrEqual(0);
  const lines = moduleMap.slice(start).split('\n').slice(1);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('|')) {
      inTable = true;
      rows.push(
        line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim()),
      );
    } else if (inTable) break;
  }
  return rows.slice(2); // drop header and separator
}

describe('module catalogue matches docs/product/module-map.md', () => {
  const rows = tableRows('Status: `MVP`');
  it('has the same modules, in order, with the same status', () => {
    const fromDoc = rows.map((r) => ({
      name: (r[1] ?? '').replace(/\*\*/g, ''),
      status: (r[6] ?? '').toLowerCase(),
    }));
    expect(fromDoc).toEqual(MODULES.map((m) => ({ name: m.moduleMapName, status: m.status })));
  });
});

describe('role catalogue matches the module map "Default roles" table', () => {
  const rows = tableRows('## Default roles');
  it('has one role per row, in order', () => {
    expect(rows.map((r) => r[0])).toEqual(ROLES.map((r) => r.moduleMapLabel));
  });
});

describe('permissions', () => {
  it('are unique and well-formed', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS)
      expect(p).toMatch(/^[a-z-]+:(read|read_own|write|approve|export)$/);
    expect(PermissionSchema.safeParse('providers:read').success).toBe(true);
    expect(PermissionSchema.safeParse('providers:delete').success).toBe(false);
    expect(PermissionSchema.safeParse('nope:read').success).toBe(false);
  });

  it('every role grants only known permissions', () => {
    for (const role of ROLES) {
      for (const p of role.permissions) expect(PERMISSIONS).toContain(p);
    }
  });

  it('denies by default', () => {
    expect(permissionsFor([]).size).toBe(0);
    expect(roleAllows([], 'command-center:read')).toBe(false);
  });

  const cases: [RoleId, string, boolean][] = [
    ['compliance_officer', 'admin:write', true],
    ['executive', 'governance:read', true],
    ['executive', 'governance:approve', true],
    ['executive', 'providers:write', false],
    ['credentialing_coordinator', 'screening:write', true],
    ['credentialing_coordinator', 'governance:read', false],
    ['board_liaison', 'readiness:read', true],
    ['board_liaison', 'readiness:write', false],
    ['board_member', 'governance:read_own', true],
    ['board_member', 'governance:read', false],
    ['qi_risk_manager', 'ftca:write', true],
    ['finance', 'scope:read', true],
    ['finance', 'scope:write', false],
    ['staff_provider', 'tasks:read_own', true],
    ['staff_provider', 'tasks:read', false],
    ['auditor', 'readiness:export', true],
    ['auditor', 'readiness:write', false],
    ['auditor', 'admin:read', false],
  ];
  it.each(cases)('%s -> %s = %s', (role, p, allowed) => {
    expect(roleAllows([role], p as never)).toBe(allowed);
  });

  it('only the auditor role is time-boxed and fully view-audited', () => {
    const boxed = ROLES.filter((r) => r.requiresEndDate).map((r) => r.id);
    expect(boxed).toEqual(['auditor']);
    expect(ROLES.find((r) => r.id === 'auditor')?.maxAccessDays).toBe(30);
  });

  it('no role other than the compliance officer can write Administration', () => {
    const writers = ROLES.filter((r) => roleAllows([r.id], 'admin:write')).map((r) => r.id);
    expect(writers).toEqual(['compliance_officer']);
  });
});
