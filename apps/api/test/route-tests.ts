/**
 * `defineRouteTests(routeId, cases)`: the one way to write an endpoint's authorization
 * tests. The type requires every case the route's access kind needs
 * (manifest REQUIRED_CASES: for a permission endpoint allowed, deniedRole, otherSite,
 * otherTenant, and reauthRequired when it needs step-up), the call fails at load time
 * if one is missing, and src/manifest.test.ts fails CI when an endpoint has no
 * `defineRouteTests` call at all.
 */
import { it } from 'vitest';
import { describeDb } from '../../../packages/db/test/helpers.js';
import { ROUTES, requiredCases, type RequiredCase, type RouteId } from '../src/manifest.js';

type Case = () => Promise<void>;

export function defineRouteTests<Id extends RouteId>(
  id: Id,
  cases: Record<RequiredCase<Id>, Case> & Record<string, Case>,
): void {
  const missing = requiredCases(id).filter((c) => !(c in cases));
  if (missing.length > 0) {
    throw new Error(`route ${id} is missing required tests: ${missing.join(', ')}`);
  }
  const spec = ROUTES[id];
  describeDb(`${id} (${spec.method} ${spec.url})`, () => {
    for (const [name, fn] of Object.entries(cases)) it(name, fn);
  });
}
