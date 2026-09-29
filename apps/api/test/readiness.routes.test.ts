/**
 * Readiness endpoints (S4): the four authorization cases each (G1-2), the audit event
 * each outcome writes (G1-3), tenant isolation (G1-1), and the recompute job each change
 * enqueues in its own transaction (G1-8). The requirement instances here are created for
 * this file against a freshly published FX-CAT catalog release.
 */
import { publishCatalogBundle } from '@deemed/readiness/service';
import { createDatabase } from '@deemed/db';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { ctx, need } from '../../../packages/db/test/helpers.js';
import { SYSTEM, fxBundles, nextCatalogVersion } from '../../../packages/readiness/test/world.js';
import {
  auditFor,
  createUser,
  signIn,
  startApi,
  stepUp,
  type Client,
  type TestApi,
  type TestUser,
} from './harness.js';
import { defineRouteTests } from './route-tests.js';

let api: TestApi;
let S1: string;
let S3: string;
const users = {} as Record<'co' | 'coS1' | 'staff' | 'auditor' | 'gco', TestUser>;
const clients = {} as Record<keyof typeof users, Client>;
const inst = {} as Record<'deaS1' | 'deaS3' | 'licS1' | 'deaGulf', string>;

async function newInstance(org: string, requirementId: string, siteId: string, personId: string) {
  const r = await api.admin.query<{ id: string }>(
    `INSERT INTO public.requirement_instance (organization_id, requirement_id, subject_type, subject_id, site_id)
     VALUES ($1, $2, 'person', $3, $4) RETURNING id::text`,
    [org, requirementId, personId, siteId],
  );
  return r.rows[0]!.id;
}

const row = async (id: string) =>
  (
    await api.admin.query(
      `SELECT status, not_applicable_reason, row_version FROM public.requirement_instance WHERE id = $1`,
      [id],
    )
  ).rows[0];

const queuedFor = async (org: string) =>
  (
    await api.admin.query(
      `SELECT 1 FROM platform.job WHERE queue = 'readiness.recompute' AND organization_id = $1 AND state = 'queued'`,
      [org],
    )
  ).rowCount;

beforeAll(async () => {
  if (!ctx.available) return;
  api = await startApi();
  const xyz = api.tenants.xyz;
  ({ S1, S3 } = xyz.siteIds as Record<'S1' | 'S3', string>);
  // The active catalog release for this file: the synthetic FX-CAT entries.
  const platform = createDatabase({ connectionString: need().platformUrl, max: 1 });
  try {
    const version = await nextCatalogVersion(api.admin);
    await platform.withPlatform(SYSTEM, (tx) =>
      publishCatalogBundle(tx, fxBundles(version).nonProduction, 'readiness route tests'),
    );
  } finally {
    await platform.close();
  }
  const person = xyz.personIds.provider1 as string;
  inst.deaS1 = await newInstance(xyz.organizationId, 'TEST-05-DEA', S1, person);
  inst.deaS3 = await newInstance(xyz.organizationId, 'TEST-05-DEA', S3, person);
  inst.licS1 = await newInstance(xyz.organizationId, 'TEST-05-LICENSE', S1, person);
  inst.deaGulf = await newInstance(
    api.tenants.gulf.organizationId,
    'TEST-05-DEA',
    api.tenants.gulf.siteIds.G1 as string,
    api.tenants.gulf.personIds.provider1 as string,
  );
  users.co = await createUser(api, 'xyz', [{ roleId: 'compliance_officer' }]);
  users.coS1 = await createUser(api, 'xyz', [{ roleId: 'compliance_officer', siteId: S1 }]);
  users.staff = await createUser(api, 'xyz', [{ roleId: 'staff_provider', siteId: S1 }]);
  users.auditor = await createUser(api, 'xyz', [{ roleId: 'auditor', expiresInDays: 14 }]);
  users.gco = await createUser(api, 'gulf', [{ roleId: 'compliance_officer' }]);
  for (const key of Object.keys(users) as (keyof typeof users)[]) {
    clients[key] = await signIn(api, users[key]);
  }
});

beforeEach(async () => {
  if (!ctx.available) return;
  for (const key of Object.keys(users) as (keyof typeof users)[]) {
    const res = await clients[key].get('/api/me');
    if (res.statusCode === 200) clients[key].csrf = res.json().csrfToken;
    else clients[key] = await signIn(api, users[key]);
  }
  // These routes need a step-up within 5 minutes (S10) for everyone who may pass the
  // permission check.
  for (const key of ['co', 'coS1', 'gco'] as const) await stepUp(api, users[key], clients[key]);
});

afterAll(async () => {
  await api?.close();
});

const NA = (id: string) => `/api/readiness/requirement-instances/${id}/not-applicable`;
const CLEAR = (id: string) => `/api/readiness/requirement-instances/${id}/not-applicable/clear`;
const match = (v: number) => ({ 'if-match': `"${v}"` });
const REASON = 'Synthetic: this practitioner does not prescribe controlled substances';

defineRouteTests('readiness.instance.not_applicable', {
  allowed: async () => {
    const before = await row(inst.deaS1);
    const res = await clients.co.post(
      NA(inst.deaS1),
      { reason: REASON },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: inst.deaS1,
      requirementId: 'TEST-05-DEA',
      status: 'not_applicable',
      recomputeQueued: true,
    });
    expect(res.headers.etag).toBe(`"${before.row_version + 1}"`);
    const events = await auditFor(api, res);
    expect(events.map((e) => [e.category, e.action, e.outcome, e.actor_type])).toEqual([
      ['mutation', 'requirement_instance.mark_not_applicable', 'success', 'user'],
    ]);
    expect(events[0]).toMatchObject({
      actor_user_id: users.co.userAccountId,
      target_id: inst.deaS1,
    });
    expect(JSON.stringify(events)).not.toContain('controlled substances');
    // The recompute was enqueued in the same transaction.
    expect(await queuedFor(users.co.organizationId)).toBe(1);
  },
  deniedRole: async () => {
    for (const who of ['staff', 'auditor'] as const) {
      const before = await row(inst.deaS3);
      const res = await clients[who].post(
        NA(inst.deaS3),
        { reason: REASON },
        match(before.row_version),
      );
      expect(res.statusCode).toBe(403);
      const [event] = await auditFor(api, res);
      expect(event).toMatchObject({ outcome: 'denied', metadata: { reason: 'permission' } });
      expect(await row(inst.deaS3)).toEqual(before);
    }
  },
  otherSite: async () => {
    const before = await row(inst.deaS3);
    const res = await clients.coS1.post(
      NA(inst.deaS3),
      { reason: REASON },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      action: 'requirement_instance.mark_not_applicable',
      outcome: 'denied',
      target_id: inst.deaS3,
      metadata: { reason: 'site_scope' },
    });
    expect(await row(inst.deaS3)).toEqual(before);
  },
  otherTenant: async () => {
    const before = await row(inst.deaS3);
    const res = await clients.gco.post(
      NA(inst.deaS3),
      { reason: REASON },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(404);
    expect(Object.keys(res.json())).toEqual(['error']);
    expect(await row(inst.deaS3)).toEqual(before);
    // The other tenant's own instance works for its own officer.
    const own = await row(inst.deaGulf);
    const ok = await clients.gco.post(NA(inst.deaGulf), { reason: REASON }, match(own.row_version));
    expect(ok.statusCode).toBe(200);
  },
  reauthRequired: async () => {
    api.clock.advance({ minutes: 6 });
    const before = await row(inst.deaS3);
    const res = await clients.co.post(
      NA(inst.deaS3),
      { reason: REASON },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('reauth_required');
    expect(await row(inst.deaS3)).toEqual(before);
  },
  requiresIfMatchAndCurrentVersion: async () => {
    expect((await clients.co.post(NA(inst.deaS3), { reason: REASON })).statusCode).toBe(428);
    const before = await row(inst.deaS3);
    const stale = await clients.co.post(
      NA(inst.deaS3),
      { reason: REASON },
      match(before.row_version + 5),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'version_conflict',
      currentVersion: before.row_version,
    });
  },
  refusesSsnShapedReasons: async () => {
    // Built at run time so no SSN-shaped literal sits in the repository (check:no-ssn).
    const ssnLike = ['900', '12', '3456'].join('-');
    const before = await row(inst.deaS3);
    for (const [url, body] of [
      [NA(inst.deaS3), { reason: `Synthetic ${ssnLike}` }],
      [CLEAR(inst.deaS3), { reason: `Synthetic ${ssnLike}` }],
      ['/api/readiness/tenant-parameters', { ...PARAM, value: 6, reason: `Synthetic ${ssnLike}` }],
    ] as const) {
      const res = await clients.co.post(url, body, match(before.row_version));
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'bad_request', fields: ['reason'] });
      expect(res.body).not.toContain(ssnLike);
    }
    expect(await row(inst.deaS3)).toEqual(before);
  },
  refusesWhereTheCatalogDoesNotAllowIt: async () => {
    const before = await row(inst.licS1);
    const res = await clients.co.post(
      NA(inst.licS1),
      { reason: REASON },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(400);
    expect(await row(inst.licS1)).toEqual(before);
    const blank = await clients.co.post(
      NA(inst.deaS3),
      { reason: '   ' },
      match(before.row_version),
    );
    expect(blank.statusCode).toBe(400);
  },
});

defineRouteTests('readiness.instance.clear_not_applicable', {
  allowed: async () => {
    const before = await row(inst.deaS1);
    expect(before.status).toBe('not_applicable');
    const res = await clients.co.post(
      CLEAR(inst.deaS1),
      { reason: 'Synthetic: now prescribes' },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'not_assessed', recomputeQueued: true });
    const events = await auditFor(api, res);
    expect(events.map((e) => [e.action, e.outcome])).toEqual([
      ['requirement_instance.clear_not_applicable', 'success'],
    ]);
    // No raw reason text in the audit row (S1).
    const raw = await api.admin.query(
      `SELECT reason, diff::text AS diff, metadata::text AS metadata FROM audit.audit_event
       WHERE request_id = $1`,
      [res.headers['x-request-id']],
    );
    expect(raw.rows[0].reason).toBeNull();
    expect(JSON.stringify(raw.rows)).not.toContain('now prescribes');
    expect(await row(inst.deaS1)).toMatchObject({ not_applicable_reason: null });
    // Nothing left to clear.
    const again = await clients.co.post(
      CLEAR(inst.deaS1),
      { reason: 'again' },
      match(before.row_version + 1),
    );
    expect(again.statusCode).toBe(409);
  },
  deniedRole: async () => {
    const before = await row(inst.deaGulf);
    const res = await clients.staff.post(CLEAR(inst.deaS1), { reason: 'x' }, match(1));
    expect(res.statusCode).toBe(403);
    expect(await row(inst.deaGulf)).toEqual(before);
  },
  otherSite: async () => {
    // Mark S3 as the org-wide officer, then the S1-scoped officer cannot clear it.
    const v = (await row(inst.deaS3)).row_version;
    expect((await clients.co.post(NA(inst.deaS3), { reason: REASON }, match(v))).statusCode).toBe(
      200,
    );
    const before = await row(inst.deaS3);
    const res = await clients.coS1.post(
      CLEAR(inst.deaS3),
      { reason: 'x' },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(403);
    expect(await row(inst.deaS3)).toEqual(before);
  },
  reauthRequired: async () => {
    api.clock.advance({ minutes: 6 });
    const before = await row(inst.deaS3);
    const res = await clients.co.post(
      CLEAR(inst.deaS3),
      { reason: 'x' },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(401);
    expect(await row(inst.deaS3)).toEqual(before);
  },
  otherTenant: async () => {
    const before = await row(inst.deaS3);
    const res = await clients.gco.post(
      CLEAR(inst.deaS3),
      { reason: 'x' },
      match(before.row_version),
    );
    expect(res.statusCode).toBe(404);
    expect(await row(inst.deaS3)).toEqual(before);
  },
});

const PARAM = {
  requirementId: 'TEST-05-PRIV',
  key: 'reprivilegingIntervalMonths',
  reason: 'Synthetic: our C&P procedures re-privilege every year',
};
const paramRow = async (org: string) =>
  (
    await api.admin.query(
      `SELECT value, row_version FROM public.tenant_parameter WHERE organization_id = $1
       AND requirement_id = 'TEST-05-PRIV' AND parameter_key = 'reprivilegingIntervalMonths'`,
      [org],
    )
  ).rows[0] as { value: number; row_version: number } | undefined;
const paramOf = async (org: string) => (await paramRow(org))?.value;
/** POST with If-Match on the current row (every seeded tenant already has a value). */
const setParam = async (who: Client, org: string, body: Record<string, unknown>) =>
  who.post(
    '/api/readiness/tenant-parameters',
    body,
    match((await paramRow(org))?.row_version ?? 1),
  );

defineRouteTests('readiness.parameter.set', {
  allowed: async () => {
    const org = users.co.organizationId;
    const res = await setParam(clients.co, org, { ...PARAM, value: 12 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ value: 12, recomputeQueued: true });
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      action: 'tenant_parameter.set',
      outcome: 'success',
      actor_type: 'user',
    });
    expect((event!.diff as { fields: Record<string, unknown> }).fields.value).toEqual({
      before: 24,
      after: 12,
    });
    expect(await paramOf(org)).toBe(12);
    // Setting the same value again changes nothing and writes nothing.
    const same = await setParam(clients.co, org, { ...PARAM, value: 12 });
    expect(same.statusCode).toBe(200);
    expect(await auditFor(api, same)).toEqual([]);
  },
  deniedRole: async () => {
    const res = await setParam(clients.auditor, users.co.organizationId, { ...PARAM, value: 6 });
    expect(res.statusCode).toBe(403);
    expect(await paramOf(users.co.organizationId)).toBe(12);
  },
  otherSite: async () => {
    // A health-center parameter covers every site: a site-scoped grant cannot set it.
    const res = await setParam(clients.coS1, users.co.organizationId, { ...PARAM, value: 6 });
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({ action: 'tenant_parameter.set', outcome: 'denied' });
    expect(await paramOf(users.co.organizationId)).toBe(12);
  },
  otherTenant: async () => {
    const res = await setParam(clients.gco, users.gco.organizationId, { ...PARAM, value: 18 });
    expect(res.statusCode).toBe(200);
    expect(await paramOf(users.gco.organizationId)).toBe(18);
    // Only the caller's own tenant changed.
    expect(await paramOf(users.co.organizationId)).toBe(12);
  },
  reauthRequired: async () => {
    api.clock.advance({ minutes: 6 });
    const res = await setParam(clients.co, users.co.organizationId, { ...PARAM, value: 6 });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('reauth_required');
    expect(await paramOf(users.co.organizationId)).toBe(12);
  },
  requiresIfMatchOrIfNoneMatch: async () => {
    const org = users.co.organizationId;
    const url = '/api/readiness/tenant-parameters';
    // No precondition: 428. Create over an existing value, or a stale version: 409.
    expect((await clients.co.post(url, { ...PARAM, value: 6 })).statusCode).toBe(428);
    const create = await clients.co.post(url, { ...PARAM, value: 6 }, { 'if-none-match': '*' });
    expect(create.statusCode).toBe(409);
    const version = (await paramRow(org))!.row_version;
    const stale = await clients.co.post(url, { ...PARAM, value: 6 }, match(version + 3));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'version_conflict', currentVersion: version });
    expect(await paramOf(org)).toBe(12);
  },
  enforcesCatalogBounds: async () => {
    const org = users.co.organizationId;
    const out = await setParam(clients.co, org, { ...PARAM, value: 30 });
    expect(out.statusCode).toBe(400);
    const unknown = await setParam(clients.co, org, { ...PARAM, key: 'madeUp', value: 3 });
    expect(unknown.statusCode).toBe(400);
    expect(await paramOf(org)).toBe(12);
  },
});
