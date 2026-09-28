/**
 * Behavior of the record API beyond the generated four cases (ADR-0014 sections 2, 4,
 * and 5; phase-1 plan S4b done-when): concurrency on the version check, scope before
 * paging (property test), read-any / write-all for multi-site records, the auditor
 * rules, D15, signed cursors, import guards (D1, flag), export limits and the formula
 * guard, reveal of a stored value, archive blockers, and bulk limits.
 */
import {
  authorize,
  getRecordType,
  type Principal,
  type RoleGrant,
  type RoleId,
} from '@deemed/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ctx, describeDb } from '../../../packages/db/test/helpers.js';
import {
  Client,
  createUser,
  signIn,
  startApi,
  stepUp,
  type GrantSpec,
  type TestUser,
} from './harness.js';
import {
  archiveAsSetup,
  as,
  eventsFor,
  fresh,
  insertRecord,
  listAll,
  makeRecord,
  nextSeq,
  startWorld,
  stopWorld,
  versionOf,
  w,
} from './record-world.js';

const match = (v: number) => ({ 'if-match': `"${v}"` });
const RI = '/api/records/requirement_instance';

/** A fake field cipher: "decrypts" by reading the bytes as UTF-8 (tests only). */
const FAKE_CIPHER = {
  decrypt: async (_ref: unknown, ciphertext: Buffer) =>
    ciphertext.toString('utf8').slice('fake:'.length),
};

beforeAll(async () => {
  if (!ctx.available) return;
  await startWorld({ fieldCipher: FAKE_CIPHER });
}, 180_000);

afterAll(async () => {
  await stopWorld();
});

describeDb('optimistic concurrency (If-Match row version)', () => {
  it('lets exactly one of several concurrent changes with the same version win', async () => {
    const id = await makeRecord('site', 'new');
    const writers = [await as('org_admin'), await as('compliance_officer')];
    const attempts = Array.from({ length: 6 }, (_, i) =>
      (writers[i % 2] as Client).patch(
        `/api/records/site/${id}`,
        { name: `Concurrent ${i}` },
        match(1),
      ),
    );
    const results = await Promise.all(attempts);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.statusCode === 409)) {
      expect(r.json().error).toMatchObject({ code: 'version_conflict', currentVersion: 2 });
    }
    expect(await versionOf(getRecordType('site'), id)).toBe(2);
    const { rows } = await w().api.admin.query(
      `SELECT count(*)::int AS n FROM audit.audit_event WHERE target_id = $1 AND action = 'site.update'`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('serializes an archive racing an update: one wins, the other gets 409', async () => {
    const id = await makeRecord('site', 'new');
    const [a, b] = await Promise.all([
      (await as('org_admin')).post(`/api/records/site/${id}/archive`, { reason: 'Race' }, match(1)),
      (await as('compliance_officer')).patch(
        `/api/records/site/${id}`,
        { city: 'Miami' },
        match(1),
      ),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it('names the fields that changed since the caller read the record (never their values)', async () => {
    const id = await makeRecord('site', 'new');
    const writer = await as('org_admin');
    expect(
      (await writer.patch(`/api/records/site/${id}`, { name: 'First edit' }, match(1))).statusCode,
    ).toBe(200);
    const stale = await writer.patch(`/api/records/site/${id}`, { city: 'Orlando' }, match(1));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toEqual(
      expect.objectContaining({ code: 'version_conflict', currentVersion: 2, fields: ['name'] }),
    );
    expect(stale.body).not.toContain('First edit');
  });

  it('keeps archived records read-only apart from restore (state_lock), and a no-op writes nothing', async () => {
    const id = await makeRecord('site', 'new');
    const writer = await as('org_admin');
    const same = await writer.patch(`/api/records/site/${id}`, { city: 'Tampa' }, match(1));
    expect(same.statusCode).toBe(200);
    expect(await eventsFor(same)).toEqual([]);
    expect(await versionOf(getRecordType('site'), id)).toBe(1);
    await writer.post(`/api/records/site/${id}/archive`, { reason: 'Closed' }, match(1));
    const res = await writer.patch(`/api/records/site/${id}`, { name: 'After archive' }, match(2));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'conflict', fields: ['archivedAt'] });
  });
});

/** Small deterministic PRNG (mulberry32) so a failure reproduces. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describeDb('scope before paging (property test)', () => {
  const REQ = 'TEST-PROP-SCOPE';
  let viewers: { name: string; grants: GrantSpec[]; user: TestUser; client: Client }[] = [];
  const statuses = ['met', 'due_soon', 'overdue', 'missing'];

  beforeAll(async () => {
    if (!ctx.available) return;
    const { S1, S2, S3 } = w().sites.xyz;
    const next = rng(42);
    const people = w().people.xyz;
    // 60 instances across three sites and the organization level, varied status and dates.
    for (let i = 0; i < 60; i++) {
      const site = [S1, S2, S3, null][Math.floor(next() * 4)] ?? null;
      const due =
        next() < 0.2 ? null : `2027-${String(1 + Math.floor(next() * 12)).padStart(2, '0')}-15`;
      await insertRecord('xyz', getRecordType('requirement_instance'), {
        requirementId: `${REQ}-${i % 7}`,
        subjectType: site ? 'site' : 'organization',
        subjectId: site ?? w().org.xyz,
        siteId: site,
        ownerPersonId: people[Math.floor(next() * people.length)],
        status: statuses[Math.floor(next() * statuses.length)],
        nextDueOn: due,
      });
    }
    const specs: { name: string; grants: GrantSpec[] }[] = [
      { name: 'org-wide', grants: [{ roleId: 'compliance_officer' }] },
      { name: 'S1', grants: [{ roleId: 'compliance_officer', siteId: S1 }] },
      {
        name: 'S2+S3',
        grants: [
          { roleId: 'compliance_officer', siteId: S2 },
          { roleId: 'compliance_officer', siteId: S3 },
        ],
      },
      { name: 'auditor', grants: [{ roleId: 'auditor', expiresInDays: 14 }] },
      { name: 'board liaison', grants: [{ roleId: 'board_liaison', siteId: S3 }] },
    ];
    viewers = [];
    for (const s of specs) {
      const user = await createUser(w().api, { organizationId: w().org.xyz }, s.grants);
      viewers.push({ ...s, user, client: await signIn(w().api, user) });
    }
  }, 120_000);

  it('never returns an out-of-scope row, misses none, and keeps the sort order, across random queries', async () => {
    const next = rng(7);
    const sorts = [
      'nextDueOn',
      '-nextDueOn',
      'status,-nextDueOn',
      'requirementId,nextDueOn',
      '-status',
    ];
    const S1 = w().sites.xyz.S1;
    for (let round = 0; round < 25; round++) {
      const params = new URLSearchParams();
      params.set(
        'filter[requirementId][in]',
        Array.from({ length: 7 }, (_, i) => `${REQ}-${i}`).join(','),
      );
      if (next() < 0.5)
        params.set('filter[status][in]', statuses.filter(() => next() < 0.6).join(',') || 'met');
      if (next() < 0.3) params.set('filter[nextDueOn][between]', '2027-03-01,2027-10-31');
      if (next() < 0.2) params.set('filter[siteId][eq]', S1);
      params.set('sort', sorts[Math.floor(next() * sorts.length)] as string);
      const limit = 1 + Math.floor(next() * 9);
      const query = params.toString();

      // The organization-wide answer is the reference; everyone else sees a subset of it.
      const reference = viewers[0] as (typeof viewers)[number];
      const all = await pageAll(reference.client, `${RI}?${query}`, limit);
      for (const v of viewers) {
        const client = v.name === 'org-wide' ? reference.client : v.client;
        const got = await pageAll(client, `${RI}?${query}`, limit);
        const now = w().api.clock.now().getTime();
        const principal: Principal = {
          organizationId: w().org.xyz,
          userAccountId: v.user.userAccountId,
          personId: v.user.personId,
          grants: v.grants.map((g, i): RoleGrant => ({
            id: `g${i}`,
            roleId: g.roleId,
            siteId: g.siteId ?? null,
            validFrom: new Date(now - 60_000),
            expiresAt: g.expiresInDays ? new Date(now + g.expiresInDays * 86_400_000) : null,
          })),
        };
        const visible = (row: Row) =>
          authorize(
            principal,
            'readiness:read',
            {
              organizationId: w().org.xyz,
              siteId: row.siteId,
              ownerPersonIds: [row.ownerPersonId ?? ''],
            },
            { now: w().api.clock.now(), approvalAreas: {} },
          ).allowed;
        // Every returned row is in scope; every in-scope row of the reference is returned,
        // in the same order; no duplicates; the total matches.
        expect(got.rows.every(visible), `${v.name} ${query}`).toBe(true);
        expect(got.rows.map((r) => r.id)).toEqual(all.rows.filter(visible).map((r) => r.id));
        expect(new Set(got.rows.map((r) => r.id)).size).toBe(got.rows.length);
        expect(got.total).toBe(got.rows.length);
      }
    }
  });

  interface Row {
    id: string;
    siteId: string | null;
    ownerPersonId: string | null;
  }
  async function pageAll(client: Client, url: string, limit: number) {
    const rows: Row[] = [];
    let cursor: string | null = null;
    let total = -1;
    for (let i = 0; i < 200; i++) {
      const res = await client.get(
        `${url}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      total = body.total;
      rows.push(
        ...body.items.map((it: { id: string; fields: Row }) => ({ ...it.fields, id: it.id })),
      );
      cursor = body.nextCursor;
      if (!cursor) return { rows, total };
    }
    throw new Error('paging did not end');
  }
});

describeDb('records linked to several sites: read any, write all', () => {
  it('lets a site-scoped administrator see a person with grants at two sites, but not change them', async () => {
    const { S1, S3 } = w().sites.xyz;
    const person = getRecordType('person');
    const personId = await insertRecord('xyz', person, {
      givenName: 'Multi',
      familyName: `Site ${nextSeq()}`,
      workEmail: `multi.${nextSeq()}@example.org`,
    });
    const account = await insertRecord('xyz', getRecordType('user_account'), {
      personId,
      loginEmail: `multi.${nextSeq()}@example.org`,
      status: 'active',
      idpIssuer: 'local',
      idpSubject: `multi-${nextSeq()}`,
    });
    for (const siteId of [S1, S3]) {
      await insertRecord('xyz', getRecordType('role_assignment'), {
        userAccountId: account,
        roleKey: 'staff_provider',
        siteId,
        validFrom: '2026-01-01T00:00:00.000Z',
        grantReason: 'multi-site test',
      });
    }
    const scoped = await as('org_admin', { siteId: S1 });
    expect((await scoped.get(`/api/records/person/${personId}`)).statusCode).toBe(200);
    const res = await scoped.patch(
      `/api/records/person/${personId}`,
      { preferredName: 'M' },
      match(1),
    );
    expect(res.statusCode).toBe(403);
    expect((await eventsFor(res))[0]).toMatchObject({ action: 'person.update', outcome: 'denied' });
    const got = (await scoped.get(`/api/records/person/${personId}`)).json();
    expect(got.allowedActions).toEqual(['history']);
    // The organization-wide administrator may.
    expect(
      (
        await (
          await as('org_admin')
        ).patch(`/api/records/person/${personId}`, { preferredName: 'M' }, match(1))
      ).statusCode,
    ).toBe(200);
  });
});

/** A person whose one user account holds these grants (field values), in the test tenant. */
async function personWithGrants(
  grants: Record<string, unknown>[],
  account: Record<string, unknown> = {},
): Promise<{ personId: string; accountId: string }> {
  const n = nextSeq();
  const personId = await insertRecord('xyz', getRecordType('person'), {
    givenName: 'Grant',
    familyName: `Case ${n}`,
    workEmail: `grant.case.${n}@example.org`,
  });
  const accountId = await insertRecord('xyz', getRecordType('user_account'), {
    personId,
    loginEmail: `grant.case.${n}@example.org`,
    status: 'active',
    idpIssuer: 'local',
    idpSubject: `grant-case-${n}`,
    ...account,
  });
  const from = new Date(w().api.clock.now().getTime() - 60_000).toISOString();
  for (const g of grants) {
    await insertRecord('xyz', getRecordType('role_assignment'), {
      userAccountId: accountId,
      roleKey: 'staff_provider',
      validFrom: from,
      grantReason: 'grant case',
      ...g,
    });
  }
  return { personId, accountId };
}

describeDb('organization-wide people and active grants (security review H1, M1)', () => {
  it("keeps a person with an organization-wide grant out of a site administrator's reach, even with a site grant too (H1)", async () => {
    const { S1 } = w().sites.xyz;
    const { personId } = await personWithGrants([
      { roleKey: 'compliance_officer', siteId: null },
      { siteId: S1 },
    ]);
    const scoped = await as('org_admin', { siteId: S1 });
    // Visible through the site grant, but not changeable.
    const got = await scoped.get(`/api/records/person/${personId}`);
    expect(got.statusCode).toBe(200);
    expect(got.json().allowedActions).toEqual(['history']);
    const res = await scoped.patch(
      `/api/records/person/${personId}`,
      { preferredName: 'X' },
      match(1),
    );
    expect(res.statusCode).toBe(403);
    expect((await eventsFor(res))[0]).toMatchObject({ action: 'person.update', outcome: 'denied' });
    const bulk = await scoped.post('/api/records/person/bulk', {
      action: 'archive',
      items: [{ id: personId, rowVersion: 1 }],
      reason: 'Cleanup',
    });
    expect(bulk.json().results).toEqual([{ id: personId, status: 'forbidden' }]);
    expect(await versionOf(getRecordType('person'), personId)).toBe(1);
    // An organization-wide administrator may.
    const admin = await as('org_admin');
    expect(
      (await admin.patch(`/api/records/person/${personId}`, { preferredName: 'X' }, match(1)))
        .statusCode,
    ).toBe(200);
  });

  it('does not let a site administrator pull an organization-wide officer into reach by granting a site role (H1)', async () => {
    const { S1 } = w().sites.xyz;
    const { personId, accountId } = await personWithGrants([
      { roleKey: 'compliance_officer', siteId: null },
    ]);
    const scoped = await fresh('org_admin', { siteId: S1 });
    expect((await scoped.get(`/api/records/person/${personId}`)).statusCode).toBe(404);
    const grant = await scoped.post('/api/admin/role-assignments', {
      userAccountId: accountId,
      roleId: 'staff_provider',
      siteId: S1,
      reason: 'Covers the S1 clinic',
    });
    expect(grant.statusCode, grant.body).toBe(200);
    expect((await scoped.get(`/api/records/person/${personId}`)).statusCode).toBe(200);
    const res = await scoped.patch(
      `/api/records/person/${personId}`,
      { preferredName: 'X' },
      match(1),
    );
    expect(res.statusCode).toBe(403);
  });

  it('derives sites only from grants the policy engine counts, on live accounts (M1)', async () => {
    const { S1 } = w().sites.xyz;
    const now = w().api.clock.now().getTime();
    const at = (ms: number) => new Date(now + ms).toISOString();
    const cases: {
      name: string;
      grant: Record<string, unknown>;
      account?: Record<string, unknown>;
      archive?: boolean;
    }[] = [
      { name: 'revoked', grant: { validFrom: at(-3_600_000), revokedAt: at(-30_000) } },
      { name: 'expired', grant: { validFrom: at(-3_600_000), expiresAt: at(-60_000) } },
      { name: 'not started', grant: { validFrom: at(3_600_000) } },
      { name: 'deprovisioned account', grant: {}, account: { status: 'deprovisioned' } },
      { name: 'archived account', grant: {}, archive: true },
    ];
    const scoped = await as('org_admin', { siteId: S1 });
    for (const c of cases) {
      const { personId, accountId } = await personWithGrants(
        [{ siteId: S1, ...c.grant }],
        c.account,
      );
      if (c.archive) await archiveAsSetup(getRecordType('user_account'), accountId);
      expect((await scoped.get(`/api/records/person/${personId}`)).statusCode, c.name).toBe(404);
      expect((await scoped.get(`/api/records/user_account/${accountId}`)).statusCode, c.name).toBe(
        404,
      );
      expect(await listAll(scoped, '/api/records/person'), c.name).not.toContain(personId);
    }
    // The control: an active grant on a live account puts the person in S1's scope.
    const live = await personWithGrants([{ siteId: S1 }]);
    expect((await scoped.get(`/api/records/person/${live.personId}`)).statusCode).toBe(200);
    expect(
      (await scoped.patch(`/api/records/person/${live.personId}`, { preferredName: 'L' }, match(1)))
        .statusCode,
    ).toBe(200);
  });
});

describeDb(
  'history, saved views, detail-only fields, and SSN-shaped text (security review L1 to L4)',
  () => {
    it("shows only the type's audit categories and successful events, never sign-in or MFA events (L1)", async () => {
      const { S1 } = w().sites.xyz;
      const target = await createUser(w().api, { organizationId: w().org.xyz }, [
        { roleId: 'staff_provider', siteId: S1 },
      ]);
      await signIn(w().api, target);
      const admin = await fresh('org_admin');
      const reset = await admin.post(`/api/admin/users/${target.userAccountId}/mfa-reset`, {
        reason: 'Lost phone',
      });
      expect(reset.statusCode, reset.body).toBe(200);
      const { rows } = await w().api.admin.query<{ category: string }>(
        `SELECT DISTINCT category FROM audit.audit_event WHERE target_id = $1`,
        [target.userAccountId],
      );
      expect(rows.map((r) => r.category)).toContain('auth');
      const history = (
        await admin.get(`/api/records/user_account/${target.userAccountId}/history`)
      ).json();
      const allowed = getRecordType('user_account').history.categories as readonly string[];
      for (const item of history.items) {
        expect(allowed, item.action).toContain(item.category);
        expect(item.outcome).toBe('success');
      }
      expect(JSON.stringify(history)).not.toMatch(/mfa|session|factor/i);

      // A role grant is a permission event on the grant, with only safe metadata.
      const grant = await admin.post('/api/admin/role-assignments', {
        userAccountId: target.userAccountId,
        roleId: 'staff_provider',
        siteId: w().sites.xyz.S3,
        reason: 'Covers S3',
      });
      const grantHistory = (
        await admin.get(`/api/records/role_assignment/${grant.json().id}/history`)
      ).json();
      expect(grantHistory.items[0]).toMatchObject({ category: 'permission', action: 'role.grant' });
      expect(Object.keys(grantHistory.items[0].metadata).sort()).toEqual([
        'role',
        'subject_user_account_id',
      ]);

      // Refused attempts on a record stay in the audit log, out of its history.
      const person = await makeRecord('person', 'B');
      const scoped = await as('org_admin', { siteId: S1 });
      expect((await scoped.get(`/api/records/person/${person}`)).statusCode).toBe(404);
      const personHistory = (await admin.get(`/api/records/person/${person}/history`)).json();
      expect(personHistory.items.every((i: { outcome: string }) => i.outcome === 'success')).toBe(
        true,
      );
    });

    it("shows a shared view's fields and operators only to others, and keeps search text and personal data out of shared views (L2)", async () => {
      const owner = await as('compliance_officer');
      const created = await owner.post('/api/records/site/saved-views', {
        name: 'Central sites',
        visibility: 'roles',
        sharedRoles: ['org_admin'],
        query: { filters: [{ field: 'timeZone', op: 'eq', value: 'America/Chicago' }], sort: [] },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id as string;
      const find = async (client: Client) =>
        (
          (await client.get('/api/records/site/saved-views')).json().items as {
            id: string;
            query: unknown;
          }[]
        ).find((v) => v.id === id);
      expect((await find(owner))?.query).toMatchObject({ filters: [{ value: 'America/Chicago' }] });
      const other = await as('org_admin');
      expect((await find(other))?.query).toEqual({
        filters: [{ field: 'timeZone', op: 'eq' }],
        sort: [],
      });
      // Applying it still uses the values, server-side.
      const rows = (await other.get(`/api/records/site?view=${id}&limit=200`)).json().items;
      expect(
        rows.every(
          (r: { fields: { timeZone: string } }) => r.fields.timeZone === 'America/Chicago',
        ),
      ).toBe(true);

      const npi = { filters: [{ field: 'npi', op: 'eq', value: '1234567893' }], sort: [] };
      const shared = { name: 'NPI', visibility: 'roles', sharedRoles: ['org_admin'] };
      const refused = await owner.post('/api/records/person/saved-views', {
        ...shared,
        query: npi,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.fields).toEqual(['query.filters.npi']);
      const search = await owner.post('/api/records/site/saved-views', {
        ...shared,
        query: { filters: [], sort: [], q: 'Main' },
      });
      expect(search.json().error.fields).toEqual(['query.q']);
      const priv = await owner.post('/api/records/person/saved-views', {
        name: 'NPI',
        visibility: 'private',
        query: npi,
      });
      expect(priv.statusCode).toBe(201);
      const widen = await owner.patch(
        `/api/records/person/saved-views/${priv.json().id}`,
        { visibility: 'roles', sharedRoles: ['org_admin'] },
        match(1),
      );
      expect(widen.statusCode).toBe(400);
    });

    it('keeps free-text reasons on the record page only: not in lists or exports (L3)', async () => {
      const id = await makeRecord('role_assignment', 'A');
      const reader = await as('org_admin');
      const list = (await reader.get('/api/records/role_assignment?limit=200')).json();
      for (const item of list.items) {
        expect(item.fields).not.toHaveProperty('grantReason');
        expect(item.fields).not.toHaveProperty('revokeReason');
      }
      expect(
        (await reader.get(`/api/records/role_assignment/${id}`)).json().record.fields.grantReason,
      ).toBe('Synthetic fixture grant');
      const exporter = await fresh('compliance_officer');
      const res = await exporter.post('/api/records/role_assignment/exports', {
        format: 'csv',
        query: {},
        columns: ['roleKey', 'grantReason'],
      });
      expect(res.statusCode).toBe(400);
      const csv = await exporter.post('/api/records/role_assignment/exports', {
        format: 'csv',
        query: {},
      });
      expect(csv.body).not.toContain('Synthetic fixture grant');
    });

    it('refuses SSN-shaped text in fields and reasons, and writes nothing (L4)', async () => {
      const shaped = ['000', '12', '3456'].join('-');
      const writer = await as('org_admin');
      const id = await makeRecord('site', 'new');
      const create = await writer.post('/api/records/site', {
        name: `Clinic ${shaped}`,
        siteType: 'service_delivery',
        addressLine1: '1 Test Way',
        city: 'Tampa',
        postalCode: '33602',
        timeZone: 'America/New_York',
        validFrom: '2026-01-01',
      });
      expect(create.statusCode).toBe(400);
      expect(create.json().error.fields).toEqual(['name']);
      expect(create.body).not.toContain(shaped);
      const update = await writer.patch(
        `/api/records/site/${id}`,
        { city: `Tampa ${shaped}` },
        match(1),
      );
      expect(update.json().error.fields).toEqual(['city']);
      const archive = await writer.post(
        `/api/records/site/${id}/archive`,
        { reason: `Dup of ${shaped}` },
        match(1),
      );
      expect(archive.statusCode).toBe(400);
      expect(
        (await writer.post(`/api/records/site/${id}/archive`, { reason: 'Duplicate' }, match(1)))
          .statusCode,
      ).toBe(200);
      const restore = await writer.post(
        `/api/records/site/${id}/restore`,
        { reason: shaped },
        match(2),
      );
      expect(restore.statusCode).toBe(400);
      const ok = await writer.post(
        `/api/records/site/${id}/restore`,
        { reason: 'Archived in error' },
        match(2),
      );
      expect(ok.statusCode).toBe(200);
      expect((await eventsFor(ok))[0]?.metadata).toMatchObject({ reason_length: 17 });
      expect(JSON.stringify(await eventsFor(ok))).not.toContain('Archived in error');
      for (const r of [create, update, archive, restore]) expect(await eventsFor(r)).toEqual([]);
    });
  },
);

describeDb('per-user limits on sensitive routes (security review M2)', () => {
  it('limits reveals, exports, and import dry runs per user whatever the address, and alerts on reveal volume', async () => {
    const lines: string[] = [];
    const limited = await startApi({
      rateLimit: { revealPerMinute: 2, revealAlertAt: 2, exportPerMinute: 1, importPerMinute: 1 },
      logger: { level: 'warn', stream: { write: (line: string) => void lines.push(line) } },
    });
    try {
      const officer = await createUser(limited, { organizationId: w().org.xyz }, [
        { roleId: 'compliance_officer' },
      ]);
      const client = await signIn(limited, officer);
      await stepUp(limited, officer, client);
      const id = await makeRecord('person', 'A');
      const reveal = (c: Client) =>
        c.post(`/api/records/person/${id}/reveal/dob`, { reasonCode: 'data_correction' });
      expect((await reveal(client)).statusCode).toBe(200);
      expect((await reveal(client)).statusCode).toBe(200);
      // The same user from another network is still the same user.
      const elsewhere = new Client(limited);
      for (const [k, v] of client.jar) elsewhere.jar.set(k, v);
      elsewhere.csrf = client.csrf;
      expect(elsewhere.ip).not.toBe(client.ip);
      const third = await reveal(elsewhere);
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('too_many_attempts');
      const alerts = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((l) => l.security_alert === 'records.reveal_volume');
      expect(alerts).toEqual([
        expect.objectContaining({ userAccountId: officer.userAccountId, count: 2, refused: false }),
        expect.objectContaining({ userAccountId: officer.userAccountId, count: 3, refused: true }),
      ]);
      // Another user has their own allowance.
      const colleague = await createUser(limited, { organizationId: w().org.xyz }, [
        { roleId: 'compliance_officer' },
      ]);
      const other = await signIn(limited, colleague);
      await stepUp(limited, colleague, other);
      expect((await reveal(other)).statusCode).toBe(200);

      const exportBody = { format: 'csv', query: {} };
      expect((await client.post('/api/records/site/exports', exportBody)).statusCode).toBe(200);
      expect((await client.post('/api/records/site/exports', exportBody)).statusCode).toBe(429);
      const csv = 'name\nX\n';
      expect((await client.post('/api/records/site/imports', { csv })).statusCode).toBe(200);
      expect((await client.post('/api/records/site/imports', { csv })).statusCode).toBe(429);
      // A new minute, a new allowance.
      limited.clock.advance({ seconds: 61 });
      await stepUp(limited, officer, client);
      expect((await reveal(client)).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describeDb('auditor and D15', () => {
  it('logs every auditor view (list with the returned ids, and get), and keeps history closed (auditor_scope)', async () => {
    const id = await makeRecord('requirement_instance', 'A');
    const auditor = await as('auditor');
    const list = await auditor.get(`${RI}?limit=3`);
    expect(list.statusCode).toBe(200);
    const [view] = await eventsFor(list);
    expect(view).toMatchObject({
      category: 'auth',
      action: 'access.view',
      target_table: 'requirement_instance',
    });
    expect(view!.metadata.ids).toEqual(list.json().items.map((i: { id: string }) => i.id));

    const get = await auditor.get(`${RI}/${id}`);
    expect(get.statusCode).toBe(200);
    expect(get.json().allowedActions).toEqual([]);
    expect((await eventsFor(get))[0]).toMatchObject({ action: 'access.view', target_id: id });

    const history = await auditor.get(`${RI}/${id}/history`);
    expect(history.statusCode).toBe(403);
    expect((await eventsFor(history))[0]).toMatchObject({
      outcome: 'denied',
      metadata: expect.objectContaining({ reason: 'record_rule' }),
    });
  });

  it('gives the health center administrator no compliance data and no exports (D15)', async () => {
    const admin = await as('org_admin');
    expect((await admin.get(RI)).statusCode).toBe(403);
    expect(
      (
        await (
          await fresh('org_admin')
        ).post('/api/records/site/exports', { format: 'csv', query: {} })
      ).statusCode,
    ).toBe(403);
    expect((await admin.get('/api/records/site')).statusCode).toBe(200);
  });
});

describeDb('lists: filters, search, cursors, archived rows', () => {
  it('filters, searches, and refuses masked fields, SSN-shaped input, and unknown parameters', async () => {
    const reader = await as('org_admin');
    const id = await makeRecord('site', 'new');
    const name = (await reader.get(`/api/records/site/${id}`)).json().record.fields.name as string;
    const found = await reader.get(`/api/records/site?q=${encodeURIComponent(name.toLowerCase())}`);
    expect(found.json().items.map((i: { id: string }) => i.id)).toContain(id);
    const shaped = ['123', '45', '6789'].join('-');
    expect((await reader.get(`/api/records/person?q=${shaped}`)).statusCode).toBe(400);
    expect((await reader.get('/api/records/person?filter[dob][eq]=1980-01-01')).statusCode).toBe(
      400,
    );
    expect((await reader.get('/api/records/site?sort=city')).statusCode).toBe(400);
    const bad = await reader.get('/api/records/site?limit=500&bogus=1');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields).toEqual(expect.arrayContaining(['limit', 'query']));
  });

  it('signs cursors to the query and the viewer, and puts no field values in them', async () => {
    const reader = await as('org_admin');
    const first = (await reader.get('/api/records/site?limit=1')).json();
    const cursor = first.nextCursor as string;
    expect(cursor).toBeTruthy();
    // The cursor names only the last row's id.
    expect(Buffer.from(cursor.split('.')[0] as string, 'base64url').toString('utf8')).toBe(
      first.items[0].id,
    );
    const tampered = `${Buffer.from('00000000-0000-4000-8000-000000000000').toString('base64url')}.${cursor.split('.')[1]}`;
    expect((await reader.get(`/api/records/site?limit=1&cursor=${tampered}`)).statusCode).toBe(400);
    expect(
      (await reader.get(`/api/records/site?limit=1&sort=-name&cursor=${cursor}`)).statusCode,
    ).toBe(400);
    const other = await as('compliance_officer');
    expect((await other.get(`/api/records/site?limit=1&cursor=${cursor}`)).statusCode).toBe(400);
    expect((await reader.get(`/api/records/site?limit=1&cursor=${cursor}`)).statusCode).toBe(200);
  });

  it('shows archived rows only to viewers who may restore them', async () => {
    const id = await makeRecord('requirement_instance', 'new');
    const writer = await as('compliance_officer');
    await writer.post(`${RI}/${id}/archive`, { reason: 'Superseded' }, match(1));
    expect(await listAll(writer, `${RI}?archived=only`)).toContain(id);
    const auditor = await as('auditor');
    expect((await auditor.get(`${RI}?archived=include`)).statusCode).toBe(403);
  });

  it('serves no DELETE route', async () => {
    const id = await makeRecord('site', 'new');
    const res = await w().api.app.inject({ method: 'DELETE', url: `/api/records/site/${id}` });
    expect(res.statusCode).toBe(404);
    expect(await versionOf(getRecordType('site'), id)).toBe(1);
  });
});

describeDb('archive blockers', () => {
  it('refuses to archive a site with active grants or a person with an active account', async () => {
    const writer = await as('org_admin');
    const S1 = w().sites.xyz.S1;
    const site = await writer.post(
      `/api/records/site/${S1}/archive`,
      { reason: 'x' },
      match(await versionOf(getRecordType('site'), S1)),
    );
    expect(site.statusCode).toBe(409);
    expect(site.json().error.fields).toEqual(
      expect.arrayContaining([
        'blockedBy.active_role_assignment',
        'blockedBy.active_requirement_instance',
      ]),
    );
    const person = await makeRecord('person', 'A');
    const res = await writer.post(
      `/api/records/person/${person}/archive`,
      { reason: 'x' },
      match(1),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.fields).toEqual(['blockedBy.active_user_account']);
  });
});

describeDb('bulk limits', () => {
  it('refuses more than 500 ids, duplicate ids, and fields that are not bulk-editable', async () => {
    const writer = await as('org_admin');
    const id = await makeRecord('site', 'new');
    const many = Array.from({ length: 501 }, () => ({ id, rowVersion: 1 }));
    expect(
      (
        await writer.post('/api/records/site/bulk', {
          action: 'update',
          items: many,
          fields: { siteType: 'mobile' },
        })
      ).statusCode,
    ).toBe(400);
    const dup = [
      { id, rowVersion: 1 },
      { id, rowVersion: 1 },
    ];
    expect(
      (
        await writer.post('/api/records/site/bulk', {
          action: 'update',
          items: dup,
          fields: { siteType: 'mobile' },
        })
      ).statusCode,
    ).toBe(400);
    const res = await writer.post('/api/records/site/bulk', {
      action: 'update',
      items: [{ id, rowVersion: 1 }],
      fields: { name: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(await versionOf(getRecordType('site'), id)).toBe(1);
  });

  it('reports a stale version per row and changes nothing for that row', async () => {
    const writer = await as('org_admin');
    const id = await makeRecord('site', 'new');
    const res = await writer.post('/api/records/site/bulk', {
      action: 'update',
      items: [{ id, rowVersion: 5 }],
      fields: { siteType: 'mobile' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([{ id, status: 'version_conflict' }]);
    expect(await eventsFor(res)).toEqual([]);
  });
});

describeDb('import dry run guards', () => {
  it('refuses a file with an SSN column, and fails rows with SSN-shaped values without echoing them (D1)', async () => {
    const writer = await as('org_admin');
    const col = await writer.post('/api/records/person/imports', {
      csv: 'givenName,familyName,SSN\nA,B,x\n',
    });
    expect(col.statusCode).toBe(200);
    expect(col.json()).toMatchObject({ refused: 'ssn_column', rows: [] });
    expect(col.json().columns[2]).toMatchObject({ header: 'SSN', status: 'blocked_ssn' });

    // An SSN-shaped value in the sampled rows blocks its whole column.
    const shaped = ['900', '12', '3456'].join('-');
    const sampled = await writer.post('/api/records/person/imports', {
      csv: `givenName,familyName,preferredName\nAna,Test,${shaped}\n`,
    });
    expect(sampled.json()).toMatchObject({ refused: 'ssn_column', rows: [] });
    expect(sampled.body).not.toContain(shaped);
    // Past the sample, the row itself fails, and the value is never echoed.
    const lines = ['givenName,familyName,preferredName'];
    for (let i = 0; i < 55; i++) lines.push(`Ana,Test ${i},${i === 54 ? shaped : 'Ana'}`);
    const late = await writer.post('/api/records/person/imports', { csv: `${lines.join('\n')}\n` });
    expect(late.statusCode).toBe(200);
    const body = late.json();
    expect(body.refused).toBeNull();
    expect(body.rows[54]).toMatchObject({
      row: 55,
      action: 'error',
      errors: [{ field: 'preferredName', code: 'ssn_value' }],
    });
    expect(body.summary).toEqual({ create: 54, update: 0, error: 1 });
    expect(late.body).not.toContain(shaped);
  });

  it('maps EN and ES header aliases and reports field errors by name only', async () => {
    const writer = await as('org_admin');
    const res = await writer.post('/api/records/person/imports', {
      csv: 'Nombre,Apellido,Correo electrónico del trabajo\nLuz,Prueba,not-an-email\n',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns.map((c: { field: string | null }) => c.field)).toEqual([
      'givenName',
      'familyName',
      'workEmail',
    ]);
    expect(body.rows[0]).toMatchObject({
      action: 'error',
      errors: [{ field: 'workEmail', code: 'invalid' }],
    });
    expect(res.body).not.toContain('not-an-email');
  });

  it('is off in every deployed environment until G4 (records.import flag)', async () => {
    const deployed = await startApi({ dhEnv: 'development' });
    try {
      const user = await createUser(deployed, 'xyz', [{ roleId: 'org_admin' }]);
      const client = await signIn(deployed, user);
      const res = await client.post('/api/records/site/imports', { csv: 'name\nX\n' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('unsupported');
    } finally {
      await deployed.close();
    }
  });
});

describeDb('export guards', () => {
  it('neutralizes spreadsheet formulas in cells', async () => {
    const id = await insertRecord('xyz', getRecordType('site'), {
      name: '=HYPERLINK("http://example.org")',
      addressLine1: '+1 Formula Way',
      city: 'Tampa',
      postalCode: '33602',
      timeZone: 'America/New_York',
      validFrom: '2026-01-01',
    });
    const res = await (
      await fresh('compliance_officer')
    ).post('/api/records/site/exports', {
      format: 'csv',
      query: { 'filter[timeZone][eq]': 'America/New_York' },
      columns: ['name'],
    });
    expect(res.statusCode, res.body).toBe(200);
    const line = res.body.split('\r\n').find((l) => l.includes(id)) as string;
    expect(line).toBe(`"${id}","'=HYPERLINK(""http://example.org"")"`);
  });

  it('refuses masked columns and more than 1,000 rows (a job arrives with S5 and S6)', async () => {
    const exporter = await fresh('compliance_officer');
    const masked = await exporter.post('/api/records/person/exports', {
      format: 'csv',
      query: {},
      columns: ['dob'],
    });
    expect(masked.statusCode).toBe(400);
    await w().api.admin.query(
      `INSERT INTO public.requirement_instance (organization_id, requirement_id, subject_type, subject_id)
       SELECT $1, 'TEST-EXPORT-LIMIT', 'organization', $1 FROM generate_series(1, 1001)`,
      [w().org.xyz],
    );
    const big = await (
      await fresh('compliance_officer')
    ).post(`${RI}/exports`, {
      format: 'csv',
      query: { 'filter[requirementId][eq]': 'TEST-EXPORT-LIMIT' },
    });
    expect(big.statusCode).toBe(413);
    expect(await eventsFor(big)).toEqual([]);
  });
});

describeDb('reveal', () => {
  it('returns a stored value once, with step-up and a reason code; the log keeps neither value nor note', async () => {
    const id = await makeRecord('person', 'A');
    await w().api.admin.query(`UPDATE public.person SET dob_enc = $2 WHERE id = $1`, [
      id,
      Buffer.from('fake:1980-02-29'),
    ]);
    const client = await fresh('compliance_officer');
    // The record view shows only that a value exists.
    expect((await client.get(`/api/records/person/${id}`)).json().record.fields.dob).toEqual({
      masked: true,
      hasValue: true,
    });
    expect(
      (await client.post(`/api/records/person/${id}/reveal/dob`, { reasonCode: 'other' }))
        .statusCode,
    ).toBe(400);
    const note = 'Checking a possible exclusion match';
    const res = await client.post(`/api/records/person/${id}/reveal/dob`, {
      reasonCode: 'other',
      note,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ field: 'dob', value: '1980-02-29' });
    const [event] = await eventsFor(res);
    expect(event).toMatchObject({
      category: 'reveal',
      action: 'person.reveal_dob',
      metadata: expect.objectContaining({ value_present: true, note_length: note.length }),
    });
    expect(JSON.stringify(event)).not.toContain('1980-02-29');
    expect(JSON.stringify(event)).not.toContain(note);
  });

  it('answers 503 and logs nothing when a value is stored but no key provider exists (S6)', async () => {
    const plain = await startApi();
    try {
      const id = await makeRecord('person', 'A');
      await plain.admin.query(`UPDATE public.person SET dob_enc = $2 WHERE id = $1`, [
        id,
        Buffer.from('fake:1990-01-01'),
      ]);
      const user = await createUser(plain, { organizationId: w().org.xyz }, [
        { roleId: 'compliance_officer' as RoleId },
      ]);
      const client = await signIn(plain, user);
      await stepUp(plain, user, client);
      const res = await client.post(`/api/records/person/${id}/reveal/dob`, {
        reasonCode: 'data_correction',
      });
      expect(res.statusCode).toBe(503);
      const { rows } = await plain.admin.query(
        `SELECT count(*)::int AS n FROM audit.audit_event WHERE request_id = $1`,
        [res.headers['x-request-id']],
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await plain.close();
    }
  });
});
