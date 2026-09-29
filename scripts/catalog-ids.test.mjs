// Every requirementId in demo and seed data must name an entry in the requirements
// catalog (CLAUDE.md: "Every regulatory rule references a requirementId from the
// catalog"), and its subject type must fit the entry. There is no compiled catalog
// bundle yet, so this reads packages/requirements-catalog/entries/ directly; the
// catalog's own entries.test.ts guarantees each file is named <id>.yaml.
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { demoSeed } from '../apps/web/lib/records-demo/seed.ts';
import { GULF_FIXTURE, XYZ_FIXTURE } from '../packages/db/seed/fixtures.ts';
import { RECORD_FIXTURES } from '../packages/test-fixtures/src/records.ts';

const dir = new URL('../packages/requirements-catalog/entries/', import.meta.url);
const catalog = new Map(
  readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => [f.slice(0, -'.yaml'.length), readFileSync(new URL(f, dir), 'utf8')]),
);
/** Entries limited to staff types (appliesTo.staffTypes) apply to a person. */
const personLevel = (id) => /^\s+staffTypes:/m.test(catalog.get(id) ?? '');

const ids = (label, id, subjectType) => ({ label, id, subjectType });
const REF = '00000000-0000-4000-8000-000000000000';

const uses = [
  ...demoSeed().requirement_instance.map((r, i) =>
    ids(`records-demo row ${i + 1}`, r.values.requirementId, r.values.subjectType),
  ),
  ...[XYZ_FIXTURE, GULF_FIXTURE].flatMap((f) => [
    ...f.requirementInstances.map((r) =>
      ids(`${f.fixtureId} ${r.key}`, r.requirementId, r.subject.type),
    ),
    ...f.approvals.flatMap((a) =>
      a.requirementIds.map((id) => ids(`${f.fixtureId} approval ${a.key}`, id)),
    ),
  ]),
  ...[REF, null].map((siteId) => {
    const r = RECORD_FIXTURES.requirement_instance({
      n: 1,
      organizationId: REF,
      siteId,
      personId: REF,
      userAccountId: REF,
    });
    return ids(`RECORD_FIXTURES site=${siteId}`, r.requirementId, r.subjectType);
  }),
];

describe('demo and seed requirementIds', () => {
  it('finds requirement ids to check', () => {
    expect(catalog.size).toBeGreaterThan(0);
    expect(uses.length).toBeGreaterThan(0);
  });

  it.each(uses)('$label uses a catalog entry ($id)', ({ id }) => {
    expect([...catalog.keys()]).toContain(id);
  });

  it.each(uses.filter((u) => u.subjectType))(
    '$label has a subject type that fits $id',
    ({ id, subjectType }) => {
      expect(subjectType === 'person').toBe(personLevel(id));
    },
  );
});
