/**
 * `defineRecordActionTests(action, cases)`: the generated four-case tests for record
 * routes (ADR-0014 section 2.9). One call per action; it runs its cases for every
 * generated route with that action, that is, for every record type (and, for reveal,
 * every revealable field). A route whose required cases (manifest REQUIRED_CASES:
 * allowed, deniedRole, otherSite, otherTenant, plus reauthRequired with step-up) are not
 * all present fails at load time, and src/manifest.test.ts fails CI when an action has
 * no suite. A new record type is covered by adding its roles and maker in
 * record-world.ts (the type system requires both).
 */
import { getRecordType, type RecordTypeDef, type RecordTypeId } from '@deemed/domain';
import { it } from 'vitest';
import { describeDb } from '../../../packages/db/test/helpers.js';
import { requiredCases, routeSpec } from '../src/manifest.js';
import {
  RECORD_ROUTE_META,
  type RecordRouteAction,
  type RecordRouteId,
  type RecordRouteMeta,
} from '../src/records/manifest.js';
import { TYPE_ROLES, type TypeRoles } from './record-world.js';

export interface RecordCase {
  def: RecordTypeDef;
  typeId: RecordTypeId;
  meta: RecordRouteMeta;
  roles: TypeRoles;
  /** `/api/records/<type>` */
  base: string;
}

type Case = (c: RecordCase) => Promise<void>;

export function defineRecordActionTests(
  action: RecordRouteAction,
  cases: Record<string, Case>,
): void {
  const routes = (Object.entries(RECORD_ROUTE_META) as [RecordRouteId, RecordRouteMeta][]).filter(
    ([, m]) => m.action === action,
  );
  for (const [id, meta] of routes) {
    const missing = requiredCases(id).filter((c) => !(c in cases));
    if (missing.length > 0)
      throw new Error(`route ${id} is missing required tests: ${missing.join(', ')}`);
    const spec = routeSpec(id);
    const def = getRecordType(meta.typeId);
    const typeId = def.id as RecordTypeId;
    const c: RecordCase = {
      def,
      typeId,
      meta,
      roles: TYPE_ROLES[typeId],
      base: `/api/records/${def.id}`,
    };
    describeDb(`${id} (${spec.method} ${spec.url})`, () => {
      for (const [name, fn] of Object.entries(cases)) it(name, () => fn(c));
    });
  }
}
