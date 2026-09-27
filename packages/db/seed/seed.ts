/**
 * Synthetic seed loader. Refuses to run when DH_ENV=production, and refuses a missing
 * or unknown DH_ENV, so a misconfigured environment never gets demo data.
 *
 * The seed connects with the migration credentials and drops to the runtime roles per
 * transaction (SET LOCAL ROLE app_platform / app_user), so it goes through the same
 * provisioning function, RLS policies, triggers, and audit writer as the application.
 * It is idempotent: a tenant that already exists is left alone.
 */
import { createHash, randomBytes } from 'node:crypto';
import { isProduction, parseDhEnv, type JsonValue } from '@deemed/domain';
import { makeTestNpi } from '@deemed/test-fixtures/npi';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { appendAuditEvent } from '../src/audit/index.js';
import {
  withPlatform,
  withTenant,
  type Actor,
  type Db,
  type TransactionContext,
  type Tx,
} from '../src/client.js';
import { listTenants, provisionOrganization } from '../src/platform.js';
import * as schema from '../src/schema/index.js';
import { KIND, fixtureId, type TenantFixture } from './fixtures.js';

export class SeedRefusedError extends Error {
  override name = 'SeedRefusedError';
}

/** Throws unless DH_ENV names a non-production environment. */
export function assertSeedAllowed(dhEnv: string | undefined): void {
  if (isProduction(dhEnv)) {
    throw new SeedRefusedError(
      'Refusing to seed: DH_ENV=production. Seed data is synthetic and non-production only.',
    );
  }
  try {
    parseDhEnv(dhEnv);
  } catch {
    throw new SeedRefusedError(
      'Refusing to seed: DH_ENV is missing or unknown. Set a non-production DH_ENV (local, preview, development, staging).',
    );
  }
}

const SEED_ACTOR: Actor = { type: 'system', label: 'synthetic seed' };

export interface SeedTenantOptions {
  /**
   * Argon2id PHC hash of the shared synthetic persona password (non-production only).
   * When set, every fixture account gets a local credential; the persona still has to
   * enroll a passkey or TOTP at first sign-in (ADR-0006 rule 3, ADR-0010 section 2).
   */
  personaPasswordHash?: string;
}

export interface SeedResult {
  organizationId: string;
  created: boolean;
  userIds: Record<string, string>;
  personIds: Record<string, string>;
  siteIds: Record<string, string>;
  /**
   * Person key -> single-use MFA enrollment token (same format as packages/auth tokens).
   * NON-PRODUCTION ONLY, and only when the tenant is created: personas need one to
   * enroll their first passkey or authenticator. Reissue with `pnpm --filter @deemed/db
   * seed:enroll <email>`.
   */
  enrollmentTokens: Record<string, string>;
}

/** Seven days, the longest an enrollment token may live (migration 0005). */
const ENROLLMENT_TOKEN_MS = 7 * 86_400_000;

/**
 * Inserts a single-use enrollment token for a user (revoking open ones) and audits it.
 * Token format and digest match packages/auth (`v1.<organizationId>.<base64url>`,
 * SHA-256 at rest). Seed tooling only; the API issues its own through AuthService.
 */
async function insertEnrollmentToken(
  tx: Tx,
  ctx: TransactionContext,
  organizationId: string,
  userAccountId: string,
  now: Date,
): Promise<string> {
  await tx
    .update(schema.enrollmentToken)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.enrollmentToken.userAccountId, userAccountId),
        isNull(schema.enrollmentToken.consumedAt),
        isNull(schema.enrollmentToken.revokedAt),
      ),
    );
  const token = `v1.${organizationId}.${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(now.getTime() + ENROLLMENT_TOKEN_MS);
  await tx.insert(schema.enrollmentToken).values({
    organizationId,
    userAccountId,
    tokenHash: createHash('sha256').update(token).digest(),
    purpose: 'invite',
    createdAt: now,
    expiresAt,
  });
  await appendAuditEvent(tx, ctx, {
    category: 'auth',
    action: 'mfa.enrollment_issued',
    targetTable: 'user_account',
    targetId: userAccountId,
    // Auth events record a client; seed tooling has none of its own.
    ipAddress: '127.0.0.1',
    userAgent: 'synthetic seed',
    metadata: { purpose: 'invite', expires_at: expiresAt.toISOString(), test: true },
  });
  return token;
}

function lookup(
  map: Record<string, string>,
  key: string | undefined,
  what: string,
): string | undefined {
  if (key === undefined) return undefined;
  const value = map[key];
  if (value === undefined) throw new Error(`seed fixture refers to unknown ${what} "${key}"`);
  return value;
}

/** A created-record diff with only internal-class fields (no PII in the audit log). */
function created(fields: Record<string, JsonValue>): JsonValue {
  return {
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, { before: null, after: v }]),
    ),
  };
}

/** Seeds one synthetic tenant through the application's own write paths. */
export async function seedTenant(
  db: Db,
  fixture: TenantFixture,
  now: Date = new Date(),
  options: SeedTenantOptions = {},
): Promise<SeedResult> {
  const id = (kind: number, n: number) => fixtureId(fixture.idPrefix, kind, n);
  const organizationId = id(KIND.organization, 1);
  const siteIds = Object.fromEntries(fixture.sites.map((s, i) => [s.key, id(KIND.site, i + 1)]));
  const personIds = Object.fromEntries(
    fixture.people.map((p, i) => [p.key, id(KIND.person, i + 1)]),
  );
  const userIds = Object.fromEntries(
    fixture.people.filter((p) => p.account).map((p, i) => [p.key, id(KIND.userAccount, i + 1)]),
  );
  const result: SeedResult = {
    organizationId,
    created: false,
    userIds,
    personIds,
    siteIds,
    enrollmentTokens: {},
  };
  const platform = { assumeRole: 'app_platform' } as const;
  const runtime = { assumeRole: 'app_user' } as const;

  const exists = await withPlatform(
    db,
    SEED_ACTOR,
    async (tx) => (await listTenants(tx)).some((t) => t.organizationId === organizationId),
    platform,
  );
  if (exists) return result;

  await withPlatform(
    db,
    SEED_ACTOR,
    (tx, ctx) =>
      provisionOrganization(tx, ctx, {
        ...fixture.organization,
        id: organizationId,
        sites: fixture.sites.map((s) => ({ ...s, id: siteIds[s.key] as string })),
      }),
    platform,
  );

  const reqIds = Object.fromEntries(
    fixture.requirementInstances.map((r, i) => [r.key, id(KIND.requirementInstance, i + 1)]),
  );
  const taskIds = Object.fromEntries(fixture.tasks.map((t, i) => [t.key, id(KIND.task, i + 1)]));
  const metadata = { fixture: fixture.fixtureId, test: true };
  const audit = (
    tx: Tx,
    ctx: TransactionContext,
    action: string,
    targetTable: string,
    targetId: string,
    diff: JsonValue,
    siteId?: string,
  ) =>
    appendAuditEvent(tx, ctx, {
      category: action.startsWith('role.') ? 'permission' : 'mutation',
      action,
      targetTable,
      targetId,
      diff,
      metadata,
      ...(siteId ? { siteId } : {}),
    });

  await withTenant(
    db,
    organizationId,
    SEED_ACTOR,
    async (tx, ctx) => {
      for (const p of fixture.people) {
        const personId = personIds[p.key] as string;
        await tx.insert(schema.person).values({
          id: personId,
          organizationId,
          givenName: p.givenName,
          familyName: p.familyName,
          preferredName: p.preferredName ?? null,
          workEmail: p.workEmail,
          npi: p.npiSeed === undefined ? null : makeTestNpi(p.npiSeed, 1).value,
          isTestRecord: p.test,
        });
        await audit(
          tx,
          ctx,
          'person.create',
          'person',
          personId,
          created({ is_test_record: true }),
        );
      }

      let grant = 0;
      for (const p of fixture.people) {
        if (!p.account) continue;
        const userId = userIds[p.key] as string;
        await tx.insert(schema.userAccount).values({
          id: userId,
          organizationId,
          personId: personIds[p.key] as string,
          idpIssuer: fixture.idpIssuer,
          idpSubject: `demo-${p.key}`,
          loginEmail: p.workEmail,
          status: 'active',
          isTestRecord: true,
        });
        if (options.personaPasswordHash !== undefined) {
          await tx.insert(schema.localCredential).values({
            organizationId,
            userAccountId: userId,
            passwordHash: options.personaPasswordHash,
            passwordSetAt: now,
          });
          result.enrollmentTokens[p.key] = await insertEnrollmentToken(
            tx,
            ctx,
            organizationId,
            userId,
            now,
          );
        }
        await audit(
          tx,
          ctx,
          'user_account.create',
          'user_account',
          userId,
          created({ status: 'active', local_password: options.personaPasswordHash !== undefined }),
        );
        for (const r of p.account.roles) {
          grant += 1;
          const assignmentId = id(KIND.roleAssignment, grant);
          const siteId = lookup(siteIds, r.site, 'site');
          const expiresAt =
            r.expiresInDays === undefined
              ? null
              : new Date(now.getTime() + r.expiresInDays * 86_400_000);
          await tx.insert(schema.roleAssignment).values({
            id: assignmentId,
            organizationId,
            userAccountId: userId,
            roleKey: r.roleKey,
            siteId: siteId ?? null,
            validFrom: now,
            expiresAt,
            grantReason: 'synthetic seed',
          });
          await audit(
            tx,
            ctx,
            'role.grant',
            'role_assignment',
            assignmentId,
            created({
              role_key: r.roleKey,
              site_id: siteId ?? null,
              expires_at: expiresAt ? expiresAt.toISOString() : null,
            }),
            siteId,
          );
        }
      }

      for (const r of fixture.requirementInstances) {
        const reqId = reqIds[r.key] as string;
        const subjectId =
          r.subject.type === 'organization'
            ? organizationId
            : r.subject.type === 'site'
              ? (lookup(siteIds, r.subject.site, 'site') as string)
              : (lookup(personIds, r.subject.person, 'person') as string);
        const siteId = lookup(siteIds, r.site, 'site');
        await tx.insert(schema.requirementInstance).values({
          id: reqId,
          organizationId,
          requirementId: r.requirementId,
          subjectType: r.subject.type,
          subjectId,
          siteId: siteId ?? null,
          ownerPersonId: lookup(personIds, r.owner, 'person') ?? null,
          status: r.status,
          notApplicableReason: r.notApplicableReason ?? null,
          nextDueOn: r.nextDueOn ?? null,
          statusComputedAt: now,
        });
        await audit(
          tx,
          ctx,
          'requirement_instance.create',
          'requirement_instance',
          reqId,
          created({ requirement_id: r.requirementId, status: r.status }),
          siteId,
        );
      }

      for (const t of fixture.tasks) {
        const taskId = taskIds[t.key] as string;
        const siteId = lookup(siteIds, t.site, 'site');
        await tx.insert(schema.task).values({
          id: taskId,
          organizationId,
          title: t.title,
          requirementInstanceId:
            lookup(reqIds, t.requirementInstance, 'requirement instance') ?? null,
          siteId: siteId ?? null,
          assigneePersonId: lookup(personIds, t.assignee, 'person') ?? null,
          dueOn: t.dueOn ?? null,
          status: t.status,
          completedAt: t.status === 'done' ? now : null,
        });
        await audit(
          tx,
          ctx,
          'task.create',
          'task',
          taskId,
          created({ status: t.status, due_on: t.dueOn ?? null }),
          siteId,
        );
      }
    },
    runtime,
  );

  // Approvals are recorded by the approving human in their own session (AI never approves).
  for (const [i, a] of fixture.approvals.entries()) {
    const approverUser = lookup(userIds, a.approver, 'account') as string;
    const approverPerson = lookup(personIds, a.approver, 'person') as string;
    const approver = fixture.people.find((p) => p.key === a.approver);
    const approvalId = id(KIND.approval, i + 1);
    const taskId = lookup(taskIds, a.task, 'task') as string;
    await withTenant(
      db,
      organizationId,
      {
        type: 'user',
        userId: approverUser,
        personId: approverPerson,
        label: `${approver?.givenName ?? ''} ${approver?.familyName ?? ''}`.trim(),
      },
      async (tx, ctx) => {
        await tx.insert(schema.approval).values({
          id: approvalId,
          organizationId,
          taskId,
          subjectType: 'task',
          subjectId: taskId,
          approverPersonId: approverPerson,
          approverUserAccountId: approverUser,
          decision: a.decision,
          comment: a.comment ?? null,
          requirementIds: [...a.requirementIds],
          decidedAt: now,
        });
        await appendAuditEvent(tx, ctx, {
          category: 'approval',
          action: 'approval.decide',
          targetTable: 'approval',
          targetId: approvalId,
          requirementIds: a.requirementIds,
          diff: created({ decision: a.decision }),
          metadata: { ...metadata, task_id: taskId },
        });
      },
      runtime,
    );
  }

  await withTenant(
    db,
    organizationId,
    SEED_ACTOR,
    (tx, ctx) =>
      appendAuditEvent(tx, ctx, {
        category: 'system',
        action: 'seed.load',
        reason: 'synthetic seed (non-production)',
        metadata: { ...metadata, people: fixture.people.length, sites: fixture.sites.length },
      }),
    runtime,
  );

  result.created = true;
  return result;
}

export interface RunSeedOptions {
  /** Migration (admin) connection string. */
  connectionString: string;
  dhEnv: string | undefined;
  fixtures: readonly TenantFixture[];
  now?: Date;
  /** See SeedTenantOptions.personaPasswordHash. */
  personaPasswordHash?: string;
}

export async function runSeed(options: RunSeedOptions): Promise<SeedResult[]> {
  assertSeedAllowed(options.dhEnv);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 2 });
  try {
    const db = drizzle(pool, { schema });
    const results: SeedResult[] = [];
    for (const fixture of options.fixtures)
      results.push(
        await seedTenant(
          db,
          fixture,
          options.now,
          options.personaPasswordHash === undefined
            ? {}
            : { personaPasswordHash: options.personaPasswordHash },
        ),
      );
    return results;
  } finally {
    await pool.end();
  }
}

export interface IssueEnrollmentOptions {
  /** Migration (admin) connection string. */
  connectionString: string;
  dhEnv: string | undefined;
  email: string;
  now?: Date;
}

/**
 * Non-production tooling: a fresh enrollment token for a synthetic persona, found by
 * login email through the same auth.resolve_login the API uses. Refuses production.
 */
export async function issuePersonaEnrollmentToken(
  options: IssueEnrollmentOptions,
): Promise<string> {
  assertSeedAllowed(options.dhEnv);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const runtime = { assumeRole: 'app_user' } as const;
    const found = await withPlatform(
      db,
      SEED_ACTOR,
      async (tx) =>
        (
          await tx.execute<{ organization_id: string; user_account_id: string }>(
            sql`SELECT organization_id::text, user_account_id::text FROM auth.resolve_login(${options.email})`,
          )
        ).rows,
      runtime,
    );
    if (found.length !== 1) throw new Error('no single active account has that login email');
    const { organization_id: organizationId, user_account_id: userAccountId } = found[0] as {
      organization_id: string;
      user_account_id: string;
    };
    return withTenant(
      db,
      organizationId,
      SEED_ACTOR,
      (tx, ctx) =>
        insertEnrollmentToken(tx, ctx, organizationId, userAccountId, options.now ?? new Date()),
      runtime,
    );
  } finally {
    await pool.end();
  }
}
