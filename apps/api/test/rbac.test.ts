/**
 * Authorization integration tests (G1-1 API half, G1-2, G1-3, G1-11): every
 * permission endpoint with its four cases (allowed, denied role, other site, other
 * tenant) plus step-up, and the audit events each outcome writes.
 */
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { ctx } from '../../../packages/db/test/helpers.js';
import {
  Client,
  GULF_REQ,
  XYZ_REQ,
  auditFor,
  createUser,
  nextCode,
  TEST_PASSWORD,
  signIn,
  startApi,
  stepUp,
  type TestApi,
  type TestUser,
  retarget,
} from './harness.js';
import { defineRouteTests } from './route-tests.js';

let api: TestApi;
let S1: string;
let S2: string;
const users = {} as Record<'co' | 'coS1' | 'staff' | 'auditor' | 'target' | 'gco', TestUser>;
const clients = {} as Record<keyof typeof users, Client>;

beforeAll(async () => {
  if (!ctx.available) return;
  api = await startApi();
  ({ S1, S2 } = api.tenants.xyz.siteIds as Record<'S1' | 'S2', string>);
  users.co = await createUser(api, 'xyz', [{ roleId: 'compliance_officer' }]);
  users.coS1 = await createUser(api, 'xyz', [{ roleId: 'compliance_officer', siteId: S1 }]);
  users.staff = await createUser(api, 'xyz', [{ roleId: 'staff_provider', siteId: S1 }]);
  users.auditor = await createUser(api, 'xyz', [{ roleId: 'auditor', expiresInDays: 14 }]);
  users.target = await createUser(api, 'xyz', [{ roleId: 'staff_provider', siteId: S2 }]);
  users.gco = await createUser(api, 'gulf', [{ roleId: 'compliance_officer' }]);
  for (const key of Object.keys(users) as (keyof typeof users)[]) {
    clients[key] = await signIn(api, users[key]);
  }
});

// The fake clock moves (TOTP steps, step-up windows); keep every session alive, and
// sign in again if an earlier test ended one, so each case tests only its own rule.
beforeEach(async () => {
  if (!ctx.available) return;
  for (const key of Object.keys(users) as (keyof typeof users)[]) {
    const res = await clients[key].get('/api/me');
    if (res.statusCode === 200) clients[key].csrf = res.json().csrfToken;
    else clients[key] = await signIn(api, users[key]);
  }
});

afterAll(async () => {
  await api?.close();
});

/** Re-authenticate everyone who acts in a step-up test, so only the tested rule decides. */
async function fresh(...who: (keyof typeof users)[]) {
  for (const w of who) await stepUp(api, users[w], clients[w]);
}

async function assignmentOf(userAccountId: string, siteId: string): Promise<string> {
  const { rows } = await api.admin.query<{ id: string }>(
    `SELECT id FROM public.role_assignment WHERE user_account_id = $1 AND site_id = $2 AND revoked_at IS NULL LIMIT 1`,
    [userAccountId, siteId],
  );
  return rows[0]!.id;
}

// ---------------------------------------------------------------------------
// GET /api/me and /api/me/navigation (session endpoints)
// ---------------------------------------------------------------------------

defineRouteTests('me', {
  allowed: async () => {
    const res = await clients.co.get('/api/me');
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.organization).toEqual({
      id: users.co.organizationId,
      name: 'XYZ Community Health Center',
    });
    expect(me.roles).toEqual(['compliance_officer']);
    expect(me.siteIds).toBeNull();
    expect(me.permissions).toContain('admin:write');
    expect(me.csrfToken).toBe(clients.co.csrf);
    const scoped = (await clients.coS1.get('/api/me')).json();
    expect(scoped.siteIds).toEqual([S1]);
  },
  unauthenticated: async () => {
    const anon = new Client(api);
    const res = await anon.get('/api/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatchObject({
      code: 'unauthenticated',
      messageKey: 'apiError.unauthenticated',
    });
    const garbage = await anon.get('/api/me', { cookie: '__Host-dh_session=v1.not.a-token' });
    expect(garbage.statusCode).toBe(401);
  },
  otherTenant: async () => {
    // Sessions are bound to one tenant: re-pointing a token at another tenant fails.
    const token = clients.co.sessionToken as string;
    const forged = retarget(token, users.co.organizationId, users.gco.organizationId);
    const res = await new Client(api).get('/api/me', { cookie: `__Host-dh_session=${forged}` });
    expect(res.statusCode).toBe(401);
    const gulf = (await clients.gco.get('/api/me')).json();
    expect(gulf.organization.id).toBe(users.gco.organizationId);
  },
});

defineRouteTests('me.navigation', {
  allowed: async () => {
    const staff = (await clients.staff.get('/api/me/navigation')).json();
    const staffModules = staff.modules.map((m: { id: string }) => m.id);
    expect(staffModules).toEqual(expect.arrayContaining(['tasks', 'self-service', 'learning']));
    expect(staffModules).not.toContain('admin');
    const staffTasks = staff.modules.find((m: { id: string }) => m.id === 'tasks');
    expect(staffTasks.pages.map((p: { route: string }) => p.route)).toEqual(['/tasks']);
    const co = (await clients.co.get('/api/me/navigation')).json();
    expect(co.modules.map((m: { id: string }) => m.id)).toContain('admin');
    const auditor = (await clients.auditor.get('/api/me/navigation')).json();
    expect(auditor.modules.map((m: { id: string }) => m.id)).toEqual(['readiness']);
  },
  unauthenticated: async () => {
    expect((await new Client(api).get('/api/me/navigation')).statusCode).toBe(401);
  },
  otherTenant: async () => {
    const token = clients.staff.sessionToken as string;
    const forged = retarget(token, users.staff.organizationId, users.gco.organizationId);
    const res = await new Client(api).get('/api/me/navigation', {
      cookie: `__Host-dh_session=${forged}`,
    });
    expect(res.statusCode).toBe(401);
  },
});

// ---------------------------------------------------------------------------
// GET /api/readiness/requirement-instances/:id
// ---------------------------------------------------------------------------

defineRouteTests('readiness.instance.get', {
  allowed: async () => {
    const res = await clients.co.get(`/api/readiness/requirement-instances/${XYZ_REQ.licRaman}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: XYZ_REQ.licRaman,
      requirementId: 'CM-05-C&P-LIP-LICENSURE',
      siteId: S1,
    });
    // Ordinary roles' reads are not audited.
    expect(await auditFor(api, res)).toEqual([]);
  },
  deniedRole: async () => {
    const res = await clients.staff.get(`/api/readiness/requirement-instances/${XYZ_REQ.licRaman}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    const events = await auditFor(api, res);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'access.denied',
      outcome: 'denied',
      actor_user_id: users.staff.userAccountId,
      metadata: {
        reason: 'permission',
        permission: 'readiness:read',
        route: 'readiness.instance.get',
      },
    });
  },
  otherSite: async () => {
    expect(
      (await clients.coS1.get(`/api/readiness/requirement-instances/${XYZ_REQ.licRaman}`))
        .statusCode,
    ).toBe(200);
    const res = await clients.coS1.get(`/api/readiness/requirement-instances/${XYZ_REQ.sfdsS3}`);
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      action: 'access.denied',
      outcome: 'denied',
      target_table: 'requirement_instance',
      target_id: XYZ_REQ.sfdsS3,
      metadata: { reason: 'site_scope' },
    });
    // An organization-wide record needs an organization-wide grant.
    expect(
      (await clients.coS1.get(`/api/readiness/requirement-instances/${XYZ_REQ.board}`)).statusCode,
    ).toBe(403);
  },
  otherTenant: async () => {
    const res = await clients.gco.get(`/api/readiness/requirement-instances/${XYZ_REQ.licRaman}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('CM-05');
    expect(Object.keys(res.json())).toEqual(['error']);
    expect(
      (await clients.gco.get(`/api/readiness/requirement-instances/${GULF_REQ.licCastillo}`))
        .statusCode,
    ).toBe(200);
  },
  auditorViewsAreLogged: async () => {
    const res = await clients.auditor.get(`/api/readiness/requirement-instances/${XYZ_REQ.sfdsS3}`);
    expect(res.statusCode).toBe(200);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      action: 'access.view',
      outcome: 'success',
      target_id: XYZ_REQ.sfdsS3,
    });
  },
});

// ---------------------------------------------------------------------------
// Administration: role grants, revokes, MFA reset (step-up required)
// ---------------------------------------------------------------------------

defineRouteTests('admin.roles.list', {
  allowed: async () => {
    const res = await clients.co.get(
      `/api/admin/users/${users.target.userAccountId}/role-assignments`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ roleId: 'staff_provider', siteId: S2 })]),
    );
  },
  deniedRole: async () => {
    const res = await clients.staff.get(
      `/api/admin/users/${users.target.userAccountId}/role-assignments`,
    );
    expect(res.statusCode).toBe(403);
  },
  otherSite: async () => {
    // A site-scoped administrator sees only grants at their own sites.
    const res = await clients.coS1.get(
      `/api/admin/users/${users.target.userAccountId}/role-assignments`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().assignments.filter((a: { siteId: string }) => a.siteId === S2)).toEqual([]);
  },
  otherTenant: async () => {
    const res = await clients.gco.get(
      `/api/admin/users/${users.target.userAccountId}/role-assignments`,
    );
    expect(res.statusCode).toBe(404);
  },
});

defineRouteTests('admin.roles.grant', {
  allowed: async () => {
    await fresh('co');
    const before = clients.target.sessionToken as string;
    const res = await clients.co.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'board_liaison',
      siteId: S2,
      reason: 'covering the board packet this quarter',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ roleId: 'board_liaison', siteId: S2, revokedAt: null });
    const events = await auditFor(api, res);
    expect(events.map((e) => [e.category, e.action, e.outcome])).toEqual([
      ['permission', 'role.grant', 'success'],
    ]);
    expect(events[0]?.diff).toMatchObject({
      fields: {
        role_key: { before: null, after: 'board_liaison' },
        site_id: { before: null, after: S2 },
      },
    });
    // The grantee's roles apply on the next request; the token rotates on the next
    // request the browser sends itself (a mutation), and the CSRF token stays valid.
    const read = await clients.target.get('/api/me');
    expect(read.json().roles).toEqual(['board_liaison', 'staff_provider']);
    expect(clients.target.sessionToken).toBe(before);
    const write = await clients.target.post('/api/auth/reauth/totp', {
      code: nextCode(api, users.target),
    });
    expect(write.statusCode).toBe(200);
    expect(clients.target.sessionToken).not.toBe(before);
    expect((await auditFor(api, write)).map((e) => e.action)).toEqual([
      'session.rotated',
      'session.reauth',
    ]);
    const stale = await new Client(api).get('/api/me', { cookie: `__Host-dh_session=${before}` });
    expect(stale.statusCode).toBe(401);
    expect((await clients.target.get('/api/me')).statusCode).toBe(200);
  },
  deniedRole: async () => {
    await fresh('staff');
    const res = await clients.staff.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'compliance_officer',
      reason: 'escalation attempt',
    });
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      action: 'access.denied',
      outcome: 'denied',
      metadata: { reason: 'permission' },
    });
  },
  otherSite: async () => {
    await fresh('coS1');
    const res = await clients.coS1.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'finance',
      siteId: S2,
      reason: 'outside my site',
    });
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      category: 'permission',
      action: 'role.grant',
      outcome: 'denied',
      target_table: 'user_account',
      target_id: users.target.userAccountId,
      metadata: { reason: 'site_scope' },
    });
  },
  otherTenant: async () => {
    await fresh('gco');
    const res = await clients.gco.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'finance',
      reason: 'cross-tenant attempt',
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await api.admin.query(
      `SELECT 1 FROM public.role_assignment WHERE user_account_id = $1 AND role_key = 'finance'`,
      [users.target.userAccountId],
    );
    expect(rows).toEqual([]);
  },
  reauthRequired: async () => {
    await fresh('co');
    api.clock.advance({ minutes: 5, seconds: 1 });
    const res = await clients.co.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'finance',
      reason: 'stale step-up',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('reauth_required');
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({
      action: 'access.denied',
      outcome: 'denied',
      metadata: { reason: 'reauth_required' },
    });
  },
  rules: async () => {
    await fresh('co');
    const self = await clients.co.post('/api/admin/role-assignments', {
      userAccountId: users.co.userAccountId,
      roleId: 'finance',
      reason: 'self grant',
    });
    expect(self.statusCode).toBe(403);
    const auditorNoEnd = await clients.co.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'auditor',
      reason: 'site visit',
    });
    expect(auditorNoEnd.statusCode).toBe(400);
    expect(auditorNoEnd.json().error.fields).toEqual(['expiresAt']);
    const tooLong = await clients.co.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'auditor',
      expiresAt: new Date(api.clock.now().getTime() + 31 * 86_400_000).toISOString(),
      reason: 'site visit',
    });
    expect(tooLong.statusCode).toBe(400);
    const areaOnStaff = await clients.co.post('/api/admin/role-assignments', {
      userAccountId: users.target.userAccountId,
      roleId: 'finance',
      approvalArea: 'finance',
      reason: 'area on a non-executive',
    });
    expect(areaOnStaff.statusCode).toBe(400);
  },
});

defineRouteTests('admin.roles.revoke', {
  allowed: async () => {
    await fresh('co');
    const id = await assignmentOf(users.target.userAccountId, S2);
    const res = await clients.co.post(`/api/admin/role-assignments/${id}/revoke`, {
      reason: 'left the role',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedAt).not.toBeNull();
    const events = await auditFor(api, res);
    expect(events.map((e) => e.action)).toEqual(['role.revoke']);
    const again = await clients.co.post(`/api/admin/role-assignments/${id}/revoke`, {
      reason: 'twice',
    });
    expect(again.statusCode).toBe(409);
  },
  deniedRole: async () => {
    await fresh('staff');
    const id = await assignmentOf(users.target.userAccountId, S2);
    expect(
      (await clients.staff.post(`/api/admin/role-assignments/${id}/revoke`, { reason: 'x' }))
        .statusCode,
    ).toBe(403);
  },
  otherSite: async () => {
    await fresh('coS1');
    const id = await assignmentOf(users.target.userAccountId, S2);
    const res = await clients.coS1.post(`/api/admin/role-assignments/${id}/revoke`, {
      reason: 'x',
    });
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({ action: 'role.revoke', outcome: 'denied', target_id: id });
  },
  otherTenant: async () => {
    await fresh('gco');
    const id = await assignmentOf(users.target.userAccountId, S2);
    expect(
      (await clients.gco.post(`/api/admin/role-assignments/${id}/revoke`, { reason: 'x' }))
        .statusCode,
    ).toBe(404);
  },
  reauthRequired: async () => {
    await fresh('co');
    api.clock.advance({ minutes: 6 });
    const id = await assignmentOf(users.target.userAccountId, S2);
    expect(
      (await clients.co.post(`/api/admin/role-assignments/${id}/revoke`, { reason: 'x' }))
        .statusCode,
    ).toBe(401);
  },
});

defineRouteTests('admin.mfa.reset', {
  deniedRole: async () => {
    await fresh('staff');
    expect(
      (
        await clients.staff.post(`/api/admin/users/${users.target.userAccountId}/mfa-reset`, {
          reason: 'x',
        })
      ).statusCode,
    ).toBe(403);
  },
  otherSite: async () => {
    // MFA reset is organization-wide; a site-scoped administrator cannot do it.
    await fresh('coS1');
    const res = await clients.coS1.post(
      `/api/admin/users/${users.target.userAccountId}/mfa-reset`,
      { reason: 'x' },
    );
    expect(res.statusCode).toBe(403);
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({ action: 'mfa.reset', category: 'auth', outcome: 'denied' });
  },
  otherTenant: async () => {
    await fresh('gco');
    const res = await clients.gco.post(`/api/admin/users/${users.target.userAccountId}/mfa-reset`, {
      reason: 'x',
    });
    expect(res.statusCode).toBe(404);
  },
  reauthRequired: async () => {
    await fresh('co');
    api.clock.advance({ minutes: 6 });
    expect(
      (
        await clients.co.post(`/api/admin/users/${users.target.userAccountId}/mfa-reset`, {
          reason: 'x',
        })
      ).statusCode,
    ).toBe(401);
  },
  notSelf: async () => {
    await fresh('co');
    const res = await clients.co.post(`/api/admin/users/${users.co.userAccountId}/mfa-reset`, {
      reason: 'x',
    });
    expect(res.statusCode).toBe(403);
  },
  allowed: async () => {
    await fresh('co');
    const res = await clients.co.post(`/api/admin/users/${users.target.userAccountId}/mfa-reset`, {
      reason: 'lost phone, identity confirmed in person',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ factorsRevoked: 1, sessionsRevoked: 1 });
    // Non-production only: the new single-use enrollment token comes back so a synthetic
    // persona can enroll again (production delivers it out of band, S5).
    const enrollmentToken = res.json().enrollmentToken as string;
    expect(enrollmentToken).toMatch(/^v1\./);
    const events = await auditFor(api, res);
    expect(events.map((e) => e.action)).toEqual([
      'session.revoked',
      'mfa.reset',
      'mfa.enrollment_issued',
    ]);
    // The free-text reason never enters the log (PII class): length and digest only.
    expect(JSON.stringify(events)).not.toContain('lost phone');
    expect(events[1]?.metadata).toMatchObject({ reason_length: 40 });
    // The target's session ended, and MFA is still mandatory: the next sign-in enrolls again.
    expect((await clients.target.get('/api/me')).statusCode).toBe(401);
    const again = new Client(api);
    const login = await again.post('/api/auth/login', {
      email: users.target.email,
      password: 'violet tram under glass 42',
    });
    expect(login.json()).toEqual({ next: 'mfa_enroll', methods: [] });
    expect(again.sessionToken).toBeUndefined();
    // The old invitation is spent; only the token from the reset enrolls.
    users.target.enrollmentToken = enrollmentToken;
    clients.target = await signIn(api, users.target);
    expect((await clients.target.get('/api/me')).statusCode).toBe(200);
  },
  consumesPendingSignIns: async () => {
    // A sign-in that passed the password before the reset cannot finish afterwards.
    const victim = await createUser(api, 'xyz', [{ roleId: 'staff_provider', siteId: S1 }]);
    await signIn(api, victim);
    const pending = new Client(api);
    await pending.post('/api/auth/login', { email: victim.email, password: TEST_PASSWORD });
    await fresh('co');
    const reset = await clients.co.post(`/api/admin/users/${victim.userAccountId}/mfa-reset`, {
      reason: 'suspected compromise',
    });
    expect(reset.statusCode).toBe(200);
    const late = await pending.post('/api/auth/mfa/totp/verify', { code: nextCode(api, victim) });
    expect(late.json().error.code).toBe('session_expired');
  },
});
