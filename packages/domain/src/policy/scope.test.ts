/**
 * `permissionScope` is what the record API compiles into SQL ("scope before paging",
 * ADR-0014 section 2.2); `authorize` is what it evaluates in memory on every row and
 * mutation. They must agree on every principal and record: this property test draws
 * random grant sets and records and compares the two.
 */
import { describe, expect, it } from 'vitest';
import { ROLE_IDS, type Permission } from '../permissions.js';
import { authorize, permissionScope, type Principal, type RoleGrant } from './policy.js';

const ORG = '0f000000-0000-4000-8000-000000000001';
const ME = '0f000000-0000-4000-8000-00000000aaaa';
const SITES = ['s1', 's2', 's3'];
const NOW = new Date('2026-09-28T12:00:00Z');

/** Small deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function covered(scope: { all: boolean; sites: readonly string[] }, sites: string[]): boolean {
  if (scope.all) return true;
  return sites.some((s) => scope.sites.includes(s));
}

describe('permissionScope agrees with authorize', () => {
  const permissions: Permission[] = [
    'readiness:read',
    'admin:read',
    'governance:read',
    'tasks:read',
    'admin:write',
    'readiness:export',
  ];

  it('for 5,000 random principals and records', () => {
    const next = rng(20260928);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] as T;
    for (let n = 0; n < 5000; n++) {
      const grants: RoleGrant[] = [];
      const count = 1 + Math.floor(next() * 3);
      for (let g = 0; g < count; g++) {
        grants.push({
          id: `g${g}`,
          roleId: pick(ROLE_IDS),
          siteId: next() < 0.4 ? null : pick(SITES),
          validFrom: new Date('2026-01-01T00:00:00Z'),
          expiresAt:
            next() < 0.1 ? new Date('2026-02-01T00:00:00Z') : new Date('2026-10-20T00:00:00Z'),
          revokedAt: next() < 0.05 ? new Date('2026-03-01T00:00:00Z') : null,
        });
      }
      const principal: Principal = {
        organizationId: ORG,
        userAccountId: 'u',
        personId: ME,
        grants,
      };
      const permission = pick(permissions);
      const siteId = next() < 0.3 ? null : pick(SITES);
      const mine = next() < 0.5;
      const decision = authorize(
        principal,
        permission,
        { organizationId: ORG, siteId, ownerPersonIds: mine ? [ME] : [] },
        { now: NOW, approvalAreas: {} },
      );
      const scope = permissionScope(principal, permission, NOW);
      const sites = siteId === null ? [] : [siteId];
      const compiled =
        (siteId === null ? scope.full.all : covered(scope.full, sites)) ||
        (mine && (siteId === null ? scope.own.all : covered(scope.own, sites)));
      expect(compiled, JSON.stringify({ grants, permission, siteId, mine })).toBe(decision.allowed);
    }
  });
});
