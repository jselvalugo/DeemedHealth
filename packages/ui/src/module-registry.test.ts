import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODULES as DOMAIN_MODULES, PERMISSIONS, permissionsFor } from '@deemed/domain';
import { isMessageKey, t } from '@deemed/i18n';
import { ICONS } from './icons.js';
import {
  AUTH_ROUTES,
  MODULES,
  RECORD_NAV,
  findRoute,
  homeRoute,
  isUuid,
  launcherModules,
  matchModule,
  matchRecordRoute,
  normalizeRoute,
  withRecordEntries,
  type ModuleEntry,
} from './module-registry.js';

type MapRow = {
  name: string;
  icon: string;
  description: string;
  pages: { name: string; route: string }[];
  status: string;
};

/** Parse the module table in docs/product/module-map.md (the source of truth). */
function readModuleMap(): MapRow[] {
  const md = readFileSync(new URL('../../../docs/product/module-map.md', import.meta.url), 'utf8');
  return md
    .split('\n')
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const [, name, icon, description, pages, , status] = cells as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      return {
        name: name.replace(/\*\*/g, ''),
        icon: icon.replace(/`/g, ''),
        description,
        pages: pages.split(' · ').map((p) => {
          const m = /^(.*?)\s*`([^`]+)`$/.exec(p.trim());
          if (!m) throw new Error(`Cannot parse page "${p}"`);
          return { name: m[1]!, route: m[2]! };
        }),
        status: status.toLowerCase(),
      };
    });
}

const map = readModuleMap();

describe('module registry matches docs/product/module-map.md', () => {
  it('has the same 16 modules in the same order', () => {
    expect(map).toHaveLength(16);
    expect(MODULES).toHaveLength(16);
    expect(MODULES.map((m) => t('en', m.name))).toEqual(map.map((r) => r.name));
  });

  it('uses the module ids and statuses from @deemed/domain', () => {
    expect(MODULES.map((m) => [m.id, m.status])).toEqual(
      DOMAIN_MODULES.map((m) => [m.id, m.status]),
    );
    expect(DOMAIN_MODULES.map((m) => m.moduleMapName)).toEqual(map.map((r) => r.name));
  });

  it('has the same icons, descriptions and statuses', () => {
    MODULES.forEach((m, i) => {
      const row = map[i]!;
      expect(m.icon, m.id).toBe(row.icon);
      expect(t('en', m.description), m.id).toBe(row.description.replace(/'/g, '’'));
      expect(m.status, m.id).toBe(row.status);
    });
  });

  it('has the same pages and routes', () => {
    const pageCount = map.reduce((n, r) => n + r.pages.length, 0);
    expect(MODULES.flatMap((m) => m.pages)).toHaveLength(pageCount);
    MODULES.forEach((m, i) => {
      expect(
        m.pages.map((p) => ({ name: t('en', p.name), route: p.route })),
        m.id,
      ).toEqual(map[i]!.pages.map((p) => ({ ...p, name: p.name.replace(/'/g, '’') })));
    });
  });

  it('uses unique routes, known icons, i18n keys and permissions', () => {
    const routes = MODULES.flatMap((m) => m.pages.map((p) => p.route));
    expect(new Set(routes).size).toBe(routes.length);
    for (const m of MODULES) {
      expect(ICONS[m.icon]).toBeDefined();
      expect(isMessageKey(m.name) && isMessageKey(m.description)).toBe(true);
      for (const p of m.pages) {
        expect(ICONS[p.icon], p.route).toBeDefined();
        expect(isMessageKey(p.name), p.route).toBe(true);
        expect(PERMISSIONS).toContain(p.permission);
        expect(p.permission.startsWith(`${m.id}:`), p.route).toBe(true);
        expect(['read', 'read_own']).toContain(p.permission.split(':')[1]);
        expect(p.route.startsWith('/'), p.route).toBe(true);
      }
    }
  });
});

describe('auth routes', () => {
  it('match the module map "Auth routes" table and never collide with module pages', () => {
    const md = readFileSync(
      new URL('../../../docs/product/module-map.md', import.meta.url),
      'utf8',
    );
    const section = md.split('## Auth routes (outside the shell)')[1]?.split('\n## ')[0] ?? '';
    const routes = [...section.matchAll(/^\|[^|]+\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
    expect(routes).toEqual(Object.values(AUTH_ROUTES));
    for (const r of routes) expect(findRoute(r!), r).toBeUndefined();
  });
});

describe('record types (module map "Record types", ADR-0014 section 3)', () => {
  const md = readFileSync(new URL('../../../docs/product/module-map.md', import.meta.url), 'utf8');
  const section = md.split('## Record types')[1]?.split('\n## ')[0] ?? '';
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.split('|').map((c) => c.trim().replace(/`/g, '')));

  it('matches RECORD_NAV, generated from the domain registry', () => {
    expect(rows.map((r) => r[1])).toEqual(RECORD_NAV.map((e) => e.recordType));
    for (const e of RECORD_NAV) {
      const row = rows.find((r) => r[1] === e.recordType)!;
      const module = MODULES.find((m) => m.id === e.module)!;
      const page = module.pages.find((p) => p.id === e.pageId)!;
      expect(row[2], e.recordType).toBe(t('en', module.name));
      expect(row[3], e.recordType).toBe(t('en', page.name).replace(/’/g, "'"));
      expect(row[4], e.recordType).toBe(e.listRoute);
      expect(row[5], e.recordType).toBe(e.recordRoute);
      expect(row[6], e.recordType).toBe(e.readPermission);
      expect(row[7]?.startsWith(e.createPermission ?? '—'), e.recordType).toBe(true);
      expect(isMessageKey(e.plural)).toBe(true);
      if (e.newLabel) expect(isMessageKey(e.newLabel)).toBe(true);
      expect(ICONS[e.icon]).toBeDefined();
    }
  });

  it('matches record routes by UUID only, so page routes never collide', () => {
    const id = 'd0000001-0002-4000-8000-000000000001';
    expect(matchRecordRoute('/admin/org')?.entry.recordType).toBe('site');
    expect(matchRecordRoute(`/admin/org/${id}`)).toMatchObject({
      id,
      entry: { recordType: 'site' },
    });
    expect(matchRecordRoute(`/readiness/${id}`)?.entry.recordType).toBe('requirement_instance');
    expect(matchRecordRoute('/readiness/evidence')).toBeUndefined();
    expect(matchRecordRoute('/admin/org/not-a-uuid')).toBeUndefined();
    expect(matchRecordRoute(`/admin/org/${id}/extra`)).toBeUndefined();
    expect(isUuid(id)).toBe(true);
    expect(isUuid(`${id}x`)).toBe(false);
    // A hosted list belongs to its page's module bar tab.
    expect(matchModule('/admin/role-assignments')?.page.id).toBe('users');
    expect(matchModule(`/admin/role-assignments/${id}`)?.page.id).toBe('users');
  });

  it('adds hosted lists and "New …" to the launcher only when the role allows', () => {
    const officer = withRecordEntries(
      launcherModules(permissionsFor(['compliance_officer'])),
      permissionsFor(['compliance_officer']),
    );
    const admin = officer.find((m) => m.id === 'admin')!;
    const extra = admin.pages.filter((p) => p.launcherOnly).map((p) => p.route);
    expect(extra).toEqual(['/admin/org?new=1', '/admin/people?new=1', '/admin/role-assignments']);
    const auditor = withRecordEntries(
      launcherModules(permissionsFor(['auditor'])),
      permissionsFor(['auditor']),
    );
    expect(auditor.flatMap((m) => m.pages).some((p) => p.id.startsWith('new-'))).toBe(false);
  });
});

describe('launcherModules', () => {
  const all = new Set(PERMISSIONS);

  it('shows every mvp and next module to a compliance officer', () => {
    const mods = launcherModules(permissionsFor(['compliance_officer']));
    expect(mods).toHaveLength(MODULES.filter((m) => m.status !== 'planned').length);
    expect(mods.flatMap((m) => m.pages)).toHaveLength(MODULES.flatMap((m) => m.pages).length);
  });

  it('leaves planned modules out of the launcher', () => {
    const planned: ModuleEntry = { ...MODULES[0]!, id: 'future', status: 'planned' };
    const ids = launcherModules(all, [...MODULES, planned]).map((m) => m.id);
    expect(ids).not.toContain('future');
  });

  it('hides modules and pages the user lacks permission for', () => {
    const coordinator = launcherModules(permissionsFor(['credentialing_coordinator']));
    expect(coordinator.map((m) => m.id)).toEqual([
      'providers',
      'enrollment',
      'screening',
      'learning',
      'tasks',
    ]);
    const staff = launcherModules(permissionsFor(['staff_provider']));
    expect(staff.map((m) => m.id)).toEqual(['learning', 'tasks', 'self-service']);
    // Own records only: "My tasks" but not the team queue, workflows, or approvals.
    expect(staff.find((m) => m.id === 'tasks')?.pages.map((p) => p.id)).toEqual(['mine']);
    expect(staff.find((m) => m.id === 'learning')?.pages.map((p) => p.id)).toEqual(['catalog']);
    const board = launcherModules(permissionsFor(['board_member']));
    expect(board.flatMap((m) => m.pages.map((p) => p.route))).toEqual([
      '/governance/meetings',
      '/me',
      '/me/documents',
      '/me/attestations',
    ]);
    const auditor = launcherModules(permissionsFor(['auditor']));
    expect(auditor.map((m) => m.id)).toEqual(['readiness']);
    expect(auditor[0]?.pages.map((p) => p.route)).toContain('/readiness/evidence');
    expect(launcherModules(new Set())).toEqual([]);
  });
});

describe('route helpers', () => {
  it('normalizes trailing slashes, query, and hash in linear time', () => {
    expect(normalizeRoute('')).toBe('/');
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('//')).toBe('/');
    expect(normalizeRoute('/providers///')).toBe('/providers');
    expect(normalizeRoute('/providers/?x=1#y')).toBe('/providers');
    const long = '/a' + '/'.repeat(100_000) + 'x';
    const start = performance.now();
    expect(normalizeRoute(long)).toBe(long);
    expect(performance.now() - start).toBeLessThan(250);
  });

  it('finds exact routes and nested module routes', () => {
    expect(findRoute('/providers/expirations')?.page.id).toBe('expirations');
    expect(findRoute('/providers/expirations/')?.page.id).toBe('expirations');
    expect(findRoute('/nope')).toBeUndefined();
    expect(matchModule('/providers/abc-123')?.module.id).toBe('providers');
    expect(matchModule('/')?.module.id).toBe('command-center');
    expect(matchModule('/no-permission')).toBeUndefined();
  });

  it('sends users home to the first page they can open', () => {
    expect(homeRoute(permissionsFor(['compliance_officer']))).toBe('/');
    expect(homeRoute(permissionsFor(['board_member']))).toBe('/governance/meetings');
    expect(homeRoute(new Set())).toBeUndefined();
  });
});
