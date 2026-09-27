/**
 * Synthetic seed loader. Refuses to run when DH_ENV=production, and refuses a missing
 * or unknown DH_ENV, so a misconfigured environment never gets demo data.
 *
 * The seed connects with the migration credentials and drops to the runtime roles per
 * transaction (SET LOCAL ROLE app_platform / app_user), so it goes through the same
 * provisioning function, RLS policies, triggers, and audit writer as the application.
 * It is idempotent: a tenant that already exists is left alone.
 */
import { isProduction, parseDhEnv, type JsonValue } from '@deemed/domain';
import { makeTestNpi } from '@deemed/test-fixtures/npi';
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

export interface SeedResult {
  organizationId: string;
  created: boolean;
  userIds: Record<string, string>;
  personIds: Record<string, string>;
  siteIds: Record<string, string>;
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
  const result: SeedResult = { organizationId, created: false, userIds, personIds, siteIds };
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
        await audit(
          tx,
          ctx,
          'user_account.create',
          'user_account',
          userId,
          created({ status: 'active' }),
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
}

export async function runSeed(options: RunSeedOptions): Promise<SeedResult[]> {
  assertSeedAllowed(options.dhEnv);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 2 });
  try {
    const db = drizzle(pool, { schema });
    const results: SeedResult[] = [];
    for (const fixture of options.fixtures)
      results.push(await seedTenant(db, fixture, options.now));
    return results;
  } finally {
    await pool.end();
  }
}
