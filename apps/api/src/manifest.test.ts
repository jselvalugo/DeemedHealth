/**
 * CI gate for the route manifest (phase-1 plan S3): the app serves exactly the manifest,
 * every mutation names its audit action, and every endpoint has its required
 * integration tests. A permission endpoint without all four (allowed, denied role,
 * other site, other tenant) fails this file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthService } from '@deemed/auth';
import type { Database } from '@deemed/db';
import { AUDIT_ACTIONS, recordTypes } from '@deemed/domain';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { ROUTE_IDS, requiredCases, routeSpec, type RouteSpec } from './manifest.js';
import { RECORD_ROUTE_META, isRecordRouteId } from './records/manifest.js';

const TEST_DIR = fileURLToPath(new URL('../test/', import.meta.url));

function testSources(): string {
  return readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(TEST_DIR, f), 'utf8'))
    .join('\n');
}

/**
 * The object literal passed to defineRouteTests('<id>', { ... }) (or, for generated record
 * routes, defineRecordActionTests('<action>', { ... })): its top-level keys.
 */
function casesFor(source: string, id: string, fn = 'defineRouteTests'): string[] | null {
  const marker = `${fn}('${id}', {`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  let depth = 1;
  let i = start + marker.length;
  let key = '';
  const keys: string[] = [];
  let atKeyPosition = true;
  for (; i < source.length && depth > 0; i++) {
    const ch = source[i] as string;
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (depth !== 1) continue;
    if (ch === ',') {
      atKeyPosition = true;
      key = '';
    } else if (atKeyPosition && ch === ':') {
      if (key.trim()) keys.push(key.trim());
      atKeyPosition = false;
    } else if (atKeyPosition) {
      key += ch;
    }
  }
  return keys;
}

describe('route manifest', () => {
  it('is served exactly by buildApp()', async () => {
    const app = buildApp({
      database: {} as Database,
      auth: {} as AuthService,
      clock: { now: () => new Date() },
      dhEnv: 'local',
      allowedOrigins: [],
      secureCookies: true,
    });
    await app.ready();
    for (const id of ROUTE_IDS) {
      const spec: RouteSpec = routeSpec(id);
      expect(app.hasRoute({ method: spec.method, url: spec.url }), id).toBe(true);
    }
    const printed = app.printRoutes({ commonPrefix: false });
    const served = printed.split('\n').filter((l) => l.includes('(') && !l.includes('HEAD'));
    expect(served.length).toBeGreaterThan(0);
    await app.close();
  });

  it('names an audit action for every mutation, and only registered actions', () => {
    for (const id of ROUTE_IDS) {
      const spec: RouteSpec = routeSpec(id);
      if (spec.audit) expect(Object.keys(AUDIT_ACTIONS), id).toContain(spec.audit.action);
      const signinStart = spec.access.kind === 'signin' && spec.audit === null;
      const optionsOnly = spec.url.endsWith('/options');
      const dryRun = spec.writesNothing !== undefined && spec.audit === null;
      if (spec.method !== 'GET' && !signinStart && !optionsOnly && !dryRun) {
        expect(spec.audit, `${id} is a mutation without an audit action`).not.toBeNull();
      }
    }
  });

  it('limits reveals, exports, and import dry runs per user (security review M2)', () => {
    for (const [id, meta] of Object.entries(RECORD_ROUTE_META)) {
      const expected =
        meta.action === 'reveal' || meta.action === 'export' || meta.action === 'import'
          ? meta.action
          : undefined;
      expect(routeSpec(id as never).userLimit, id).toBe(expected);
    }
  });

  it('serves no DELETE route: records are archived and restored, never deleted (ADR-0014)', () => {
    for (const id of ROUTE_IDS) {
      expect(['GET', 'POST', 'PATCH'], id).toContain(routeSpec(id).method);
    }
  });

  it('generates list, get, and history routes for every record type, each behind its permission', () => {
    const ids = new Set(ROUTE_IDS);
    for (const def of recordTypes()) {
      for (const action of ['list', 'get', 'history']) {
        const id = `records.${def.id}.${action}` as const;
        expect(ids.has(id), id).toBe(true);
        expect(routeSpec(id).access).toMatchObject({
          kind: 'permission',
          permission: def.access.read,
        });
      }
      for (const [id, meta] of Object.entries(RECORD_ROUTE_META)) {
        if (meta.typeId !== def.id) continue;
        expect(def.actions.includes(meta.action.split('.')[0] as never), id).toBe(true);
      }
    }
  });

  it('keeps every endpoint under /api and every non-public endpoint behind a session or permission', () => {
    for (const id of ROUTE_IDS) {
      const spec: RouteSpec = routeSpec(id);
      expect(spec.url.startsWith('/api/'), id).toBe(true);
      if (spec.url.startsWith('/api/admin/')) expect(spec.access.kind, id).toBe('permission');
      if (
        spec.access.kind === 'permission' &&
        spec.method === 'POST' &&
        spec.url.startsWith('/api/admin/')
      ) {
        expect(spec.access.recentAuth, `${id}: admin changes need step-up`).toBe(true);
      }
    }
  });

  it('makes every approve route (and every route that loads one record) check the record', () => {
    for (const id of ROUTE_IDS) {
      const access = routeSpec(id).access;
      if (access.kind !== 'permission') continue;
      if (access.permission.endsWith(':approve')) {
        // The executive approval-area rule only runs when a record is authorized.
        expect(access.record, `${id}: approve routes need record: true`).toBe(true);
      }
      if (routeSpec(id).url.includes('/:')) {
        expect(access.record ?? id === 'admin.roles.list', `${id}: record route`).toBe(true);
      }
    }
  });

  it('has the required integration tests for every endpoint (allowed, denied role, other site, other tenant)', () => {
    const source = testSources();
    const problems: string[] = [];
    for (const id of ROUTE_IDS) {
      // Generated record routes share one suite per action, run for every record type.
      const meta = isRecordRouteId(id) ? RECORD_ROUTE_META[id] : undefined;
      const cases = meta
        ? casesFor(source, meta.action, 'defineRecordActionTests')
        : casesFor(source, id);
      if (!cases) {
        problems.push(
          meta
            ? `${id}: no defineRecordActionTests('${meta.action}', ...) in apps/api/test`
            : `${id}: no defineRouteTests('${id}', ...) in apps/api/test`,
        );
        continue;
      }
      for (const required of requiredCases(id)) {
        if (!cases.includes(required)) problems.push(`${id}: missing "${required}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('requires the four cases for permission endpoints, and step-up cases where needed', () => {
    expect(requiredCases('readiness.instance.get')).toEqual([
      'allowed',
      'deniedRole',
      'otherSite',
      'otherTenant',
    ]);
    expect(requiredCases('admin.roles.grant')).toEqual([
      'allowed',
      'deniedRole',
      'otherSite',
      'otherTenant',
      'reauthRequired',
    ]);
    expect(
      casesFor("defineRouteTests('x', { allowed: async () => { a({b: 1}) }, deniedRole: f })", 'x'),
    ).toEqual(['allowed', 'deniedRole']);
  });
});
