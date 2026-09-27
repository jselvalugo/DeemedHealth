/**
 * Integration harness for apps/api: the real app (buildApp) on the real PostgreSQL 16
 * from the @deemed/db global setup, logged in as the runtime role, with a fake clock.
 * No network: requests go through Fastify's inject().
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AuthService,
  FakeClock,
  generateTotp,
  hashPassword,
  issueToken,
  secretFromBase32,
} from '@deemed/auth';
import { createDatabase, schema, type Database } from '@deemed/db';
import type { RoleId } from '@deemed/domain';
import pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { fixtureId, KIND } from '../../../packages/db/seed/fixtures.js';
import { need } from '../../../packages/db/test/helpers.js';
import { SoftwareAuthenticator } from './authenticator.js';

export const ORIGIN = 'https://app.test';
export const RP_ID = 'app.test';
export const TEST_PASSWORD = 'violet tram under glass 42';

export interface TestApi {
  app: FastifyInstance;
  clock: FakeClock;
  database: Database;
  admin: pg.Client;
  tenants: ReturnType<typeof need>['tenants'];
  close(): Promise<void>;
}

export async function startApi(): Promise<TestApi> {
  const c = need();
  // Seeded grants start at seed time (real clock); run the fake clock a little later.
  const clock = new FakeClock(new Date(Date.now() + 5 * 60_000));
  const database = createDatabase({ connectionString: c.appUserUrl, max: 4 });
  const auth = new AuthService({
    db: database,
    clock,
    secretKey: { root: randomBytes(32) },
    webauthn: { rpId: RP_ID, rpName: 'Deemed Health', origins: [ORIGIN] },
  });
  const app = buildApp({
    database,
    auth,
    clock,
    dhEnv: 'local',
    allowedOrigins: [ORIGIN],
    secureCookies: true,
    // Rate limits are tested on their own (src/rate-limit.test.ts).
    rateLimit: { globalPerMinute: 1_000_000, signinPerMinute: 1_000_000 },
  });
  await app.ready();
  const admin = new pg.Client({ connectionString: c.adminUrl });
  await admin.connect();
  return {
    app,
    clock,
    database,
    admin,
    tenants: c.tenants,
    async close() {
      await app.close();
      await database.close();
      await admin.end();
    },
  };
}

/** Seeded requirement instances (packages/db/seed/fixtures.ts). */
export const XYZ_REQ = {
  licRaman: fixtureId('d0000001', KIND.requirementInstance, 1), // person subject, site S1
  licRivera: fixtureId('d0000001', KIND.requirementInstance, 2), // site S3
  board: fixtureId('d0000001', KIND.requirementInstance, 3), // organization-wide
  sfdsS3: fixtureId('d0000001', KIND.requirementInstance, 4), // site S3
};
export const GULF_REQ = { licCastillo: fixtureId('d0000002', KIND.requirementInstance, 1) };

let ipCounter = 0;
/** A distinct client address per client, so IP throttling in one test never leaks into another. */
function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 8) & 255}.${ipCounter & 255}.${1 + Math.floor(Math.random() * 250)}`;
}

/** A browser: cookie jar, same-origin headers, CSRF token after sign-in. */
export class Client {
  readonly jar = new Map<string, string>();
  csrf: string | undefined;
  readonly ip = nextIp();

  constructor(readonly api: TestApi) {}

  async request(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.api.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: {
        'user-agent': 'vitest-browser',
        ...(cookie ? { cookie } : {}),
        ...(method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
        ...(method === 'POST' && this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
      ...(method === 'POST' ? { payload: JSON.stringify(body ?? {}) } : {}),
    });
    const set = res.headers['set-cookie'];
    for (const line of set === undefined ? [] : Array.isArray(set) ? set : [set]) {
      const first = line.split(';', 1)[0] as string;
      const eq = first.indexOf('=');
      const name = first.slice(0, eq);
      const value = first.slice(eq + 1);
      if (line.includes('Max-Age=0') || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request('GET', url, undefined, headers);
  }

  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', url, body, headers);
  }

  get sessionToken(): string | undefined {
    return this.jar.get('__Host-dh_session');
  }
}

export interface TestUser {
  organizationId: string;
  userAccountId: string;
  personId: string;
  email: string;
  /** Single-use code for enrolling the first factor (an invitation, delivered out of band). */
  enrollmentToken: string;
  totpSecret?: Buffer;
  passkey?: SoftwareAuthenticator;
}

export interface GrantSpec {
  roleId: RoleId | 'org_admin';
  siteId?: string;
  /** Days after now; auditors need one (max 30). */
  expiresInDays?: number;
  approvalArea?: string;
}

let passwordHash: Promise<string> | undefined;

/**
 * A fresh synthetic user with a local password and the given role grants, written
 * straight to the database (test setup, not an application path).
 */
export async function createUser(
  api: TestApi,
  tenant: 'xyz' | 'gulf',
  grants: GrantSpec[],
): Promise<TestUser> {
  passwordHash ??= hashPassword(TEST_PASSWORD);
  const hash = await passwordHash;
  const organizationId = api.tenants[tenant].organizationId;
  const suffix = randomBytes(4).toString('hex');
  const email = `test.${suffix}@${tenant}-chc.example`;
  const personId = randomUUID();
  const userAccountId = randomUUID();
  const setup = createDatabase({
    connectionString: need().adminUrl,
    assumeRole: 'app_user',
    max: 1,
  });
  const now = api.clock.now();
  const enrollment = issueToken(organizationId);
  try {
    await setup.withTenant(organizationId, { type: 'system', label: 'test setup' }, async (tx) => {
      await tx.insert(schema.person).values({
        id: personId,
        organizationId,
        givenName: 'Test',
        familyName: `User ${suffix}`,
        workEmail: email,
        isTestRecord: true,
      });
      await tx.insert(schema.userAccount).values({
        id: userAccountId,
        organizationId,
        personId,
        idpIssuer: 'local',
        idpSubject: suffix,
        loginEmail: email,
        status: 'active',
        isTestRecord: true,
      });
      await tx.insert(schema.localCredential).values({
        organizationId,
        userAccountId,
        passwordHash: hash,
        passwordSetAt: now,
      });
      await tx.insert(schema.enrollmentToken).values({
        organizationId,
        userAccountId,
        tokenHash: enrollment.hash,
        purpose: 'invite',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 72 * 3_600_000),
      });
      for (const g of grants) {
        const validFrom = new Date(now.getTime() - 60_000);
        await tx.insert(schema.roleAssignment).values({
          organizationId,
          userAccountId,
          roleKey: g.roleId,
          siteId: g.siteId ?? null,
          validFrom,
          expiresAt:
            g.expiresInDays === undefined
              ? null
              : new Date(validFrom.getTime() + g.expiresInDays * 86_400_000),
          approvalArea: g.approvalArea ?? null,
          grantReason: 'test setup',
        });
      }
    });
  } finally {
    await setup.close();
  }
  return { organizationId, userAccountId, personId, email, enrollmentToken: enrollment.token };
}

/** The next valid code, moving the fake clock one TOTP step so codes never replay. */
export function nextCode(api: TestApi, user: TestUser): string {
  api.clock.advance({ seconds: 30 });
  return generateTotp(user.totpSecret as Buffer, api.clock.now());
}

/** Signs in with password + TOTP, enrolling TOTP at the first sign-in. */
export async function signIn(
  api: TestApi,
  user: TestUser,
  client = new Client(api),
): Promise<Client> {
  const login = await client.post('/api/auth/login', {
    email: user.email,
    password: TEST_PASSWORD,
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const step = login.json() as { next: string };
  if (step.next === 'mfa_enroll') {
    const enrollmentToken = user.enrollmentToken;
    const enroll = await client.post('/api/auth/mfa/totp/enroll', { enrollmentToken });
    if (enroll.statusCode !== 200) {
      throw new Error(`enroll failed: ${enroll.statusCode} ${enroll.body}`);
    }
    user.totpSecret = secretFromBase32((enroll.json() as { secret: string }).secret);
    const done = await client.post('/api/auth/mfa/totp/enroll/verify', {
      enrollmentToken,
      code: nextCode(api, user),
    });
    if (done.statusCode !== 200) throw new Error(`enroll failed: ${done.statusCode} ${done.body}`);
    client.csrf = (done.json() as { csrfToken: string }).csrfToken;
  } else {
    const done = await client.post('/api/auth/mfa/totp/verify', { code: nextCode(api, user) });
    if (done.statusCode !== 200) throw new Error(`mfa failed: ${done.statusCode} ${done.body}`);
    client.csrf = (done.json() as { csrfToken: string }).csrfToken;
  }
  return client;
}

/** Fresh step-up so routes with recentAuth pass. */
export async function stepUp(api: TestApi, user: TestUser, client: Client): Promise<void> {
  const res = await client.post('/api/auth/reauth/totp', { code: nextCode(api, user) });
  if (res.statusCode !== 200) throw new Error(`reauth failed: ${res.statusCode} ${res.body}`);
}

export interface AuditRow {
  organization_id: string;
  category: string;
  action: string;
  outcome: string;
  actor_type: string;
  actor_user_id: string | null;
  target_table: string | null;
  target_id: string | null;
  diff: unknown;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
}

/** Audit events written for one response (correlated through x-request-id). */
export async function auditFor(api: TestApi, res: LightMyRequestResponse): Promise<AuditRow[]> {
  const requestId = res.headers['x-request-id'] as string;
  const { rows } = await api.admin.query<AuditRow>(
    `SELECT organization_id, category, action, outcome, actor_type, actor_user_id, target_table,
            target_id::text, diff, metadata, host(ip_address) AS ip_address, user_agent
     FROM audit.audit_event WHERE request_id = $1 ORDER BY chain_seq`,
    [requestId],
  );
  return rows;
}

/** A session token re-pointed at another tenant (split/join, every occurrence). */
export function retarget(
  token: string,
  fromOrganizationId: string,
  toOrganizationId: string,
): string {
  return token.split(fromOrganizationId).join(toOrganizationId);
}
