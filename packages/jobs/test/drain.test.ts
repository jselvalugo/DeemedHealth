/**
 * The job queue (ADR-0001, ADR-0010 section 3): transactional enqueue, drain(), retries,
 * leases (resumable runs), singleton coalescing, budgets, and role boundaries.
 * Uses its own queue names, so other files' jobs are never claimed here.
 */
import { randomUUID } from 'node:crypto';
import { createDatabase, provisionOrganization, type Actor, type Database } from '@deemed/db';
import { JobError, drain, sendJob, sendPlatformJob, type ClaimedJob } from '@deemed/jobs';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connect, describeDb, expectPgError, need } from '../../db/test/helpers.js';

const SYSTEM: Actor = { type: 'system', label: 'jobs test' };
const Q = 'test.echo';
const Q2 = 'test.flaky';

describeDb('job queue and drain()', () => {
  let admin: pg.Client;
  let tenant: Database;
  let platform: Database;
  let org: string;

  beforeAll(async () => {
    const c = need();
    admin = await connect(c.adminUrl);
    // Test job kinds (S5): registered like migrations register real ones.
    await admin.query(`
      INSERT INTO platform.job_kind (queue, tenant_enqueueable, actor_label, max_attempts,
                                     tenant_payload_keys, platform_payload_keys, max_queued_per_tenant)
      VALUES ('test.echo', true, 'test echo', 5, ARRAY['n', 'big'], ARRAY['n', 'fanout'], 20),
             ('test.flaky', true, 'test flaky', 5, '{}', '{}', 20),
             ('test.capped', true, 'test capped', 2, '{}', '{}', 2),
             ('test.platform_only', false, 'test platform only', 3, '{}', ARRAY['n'], 20)
      ON CONFLICT (queue) DO NOTHING`);
    tenant = createDatabase({ connectionString: c.appUserUrl, max: 2 });
    platform = createDatabase({ connectionString: c.platformUrl, max: 2 });
    org = await platform.withPlatform(SYSTEM, (tx, context) =>
      provisionOrganization(tx, context, {
        legalName: `Jobs Test Health Center ${randomUUID().slice(0, 6)}`,
        awardType: 'lookalike',
        subPrograms: ['CHC'],
        timeZone: 'America/Chicago',
        addressLine1: '1 Queue Way',
        city: 'Pensacola',
        state: 'FL',
        postalCode: '32501',
        isTestRecord: true,
        sites: [
          {
            name: 'Queue Panhandle',
            addressLine1: '1 Queue Way',
            city: 'Pensacola',
            state: 'FL',
            postalCode: '32501',
            timeZone: 'America/Chicago',
          },
        ],
      }),
    );
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), tenant?.close(), platform?.close()]);
  });

  const jobs = async (queue: string) =>
    (
      await admin.query(
        `SELECT id::text, state, attempts, last_error_code, singleton_key, payload, started_at, finished_at
         FROM platform.job WHERE queue = $1 AND organization_id = $2 ORDER BY created_at, id`,
        [queue, org],
      )
    ).rows;

  it('enqueues only when the transaction commits', async () => {
    await expect(
      tenant.withTenant(org, SYSTEM, async (tx) => {
        await sendJob(tx, Q, { payload: { n: 1 } });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await jobs(Q)).toEqual([]);
    const id = await tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q, { payload: { n: 2 } }));
    expect(await jobs(Q)).toEqual([expect.objectContaining({ id, state: 'queued', attempts: 0 })]);
  });

  it('drains: runs the handler, marks the job completed, and keeps the run record', async () => {
    const seen: ClaimedJob[] = [];
    const result = await drain({
      platform,
      handlers: { [Q]: async (job) => void seen.push(job) },
    });
    expect(result.stoppedBy).toBe('empty');
    expect(seen).toEqual([
      expect.objectContaining({ queue: Q, organizationId: org, payload: { n: 2 }, attempts: 1 }),
    ]);
    const [row] = await jobs(Q);
    expect(row).toMatchObject({ state: 'completed', attempts: 1, last_error_code: null });
    expect(row.started_at).toBeInstanceOf(Date);
    expect(row.finished_at).toBeInstanceOf(Date);
    // Draining again finds nothing: a completed job never runs twice.
    expect((await drain({ platform, handlers: { [Q]: async () => undefined } })).runs).toEqual([]);
  });

  it('coalesces queued jobs with the same singleton key', async () => {
    const a = await tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q2, { singletonKey: 'k1' }));
    const b = await tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q2, { singletonKey: 'k1' }));
    expect(b).toBe(a);
    expect((await jobs(Q2)).filter((j) => j.state === 'queued')).toHaveLength(1);
  });

  it('retries a failed run with its error code (never the message), then fails it after max attempts', async () => {
    let calls = 0;
    const handlers = {
      [Q2]: async () => {
        calls += 1;
        if (calls === 1) throw new JobError('upstream_unavailable', { retryAfterSeconds: 0 });
        throw new Error('free text that must not be stored');
      },
    };
    // With no retry delay the drain keeps retrying until max_attempts (default 5).
    const r1 = await drain({ platform, handlers, retryAfterSeconds: () => 0 });
    expect(r1.runs.map((r) => [r.outcome, r.errorCode])).toEqual([
      ['queued', 'upstream_unavailable'],
      ['queued', 'handler_error'],
      ['queued', 'handler_error'],
      ['queued', 'handler_error'],
      ['failed', 'handler_error'],
    ]);
    const [row] = await jobs(Q2);
    expect(row).toMatchObject({ state: 'failed', attempts: 5, last_error_code: 'handler_error' });
    expect(JSON.stringify(await jobs(Q2))).not.toContain('free text');
  });

  it('resumes a run whose worker died (expired lease), and stops at the budget', async () => {
    await tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q, { payload: { n: 3 } }));
    // A worker claims the job and dies before completing it.
    const claimed = await platform.withPlatform(
      SYSTEM,
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`SELECT id::text FROM platform.claim_jobs(ARRAY['test.echo'], 10, 60)`,
          )
        ).rows,
    );
    expect(claimed).toHaveLength(1);
    // Within the lease nobody else runs it.
    expect((await drain({ platform, handlers: { [Q]: async () => undefined } })).runs).toEqual([]);
    await admin.query(
      `UPDATE platform.job SET locked_until = now() - interval '1 second' WHERE id = $1`,
      [claimed[0]!.id],
    );
    // A zero budget claims nothing.
    const none = await drain({ platform, handlers: { [Q]: async () => undefined }, budgetMs: 0 });
    expect(none).toEqual({ stoppedBy: 'budget', runs: [] });
    const resumed = await drain({ platform, handlers: { [Q]: async () => undefined } });
    expect(resumed.runs).toEqual([{ id: claimed[0]!.id, queue: Q, outcome: 'completed' }]);
    const row = (await jobs(Q)).find((j) => j.id === claimed[0]!.id);
    expect(row).toMatchObject({ state: 'completed', attempts: 2 });
  });

  it('keeps role boundaries: app_user only enqueues for its own tenant; app_platform only through functions', async () => {
    const user = await connect(need().appUserUrl);
    try {
      await expectPgError(user.query('SELECT 1 FROM platform.job'), '42501');
      await expectPgError(
        user.query(`SELECT * FROM platform.claim_jobs(ARRAY['test.echo'], 1, 60)`),
        '42501',
      );
      // No tenant context: the enqueue raises instead of guessing.
      await expectPgError(user.query(`SELECT public.enqueue_job('test.echo')`), '42704');
    } finally {
      await user.end();
    }
    const plat = await connect(need().platformUrl);
    try {
      await expectPgError(
        plat.query(`INSERT INTO platform.job (queue, actor_label) VALUES ('test.echo', 'x')`),
        '42501',
      );
      await expectPgError(plat.query(`SELECT public.enqueue_job('test.echo')`), '42501');
    } finally {
      await plat.end();
    }
    // The platform role fans out through its own function.
    const id = await platform.withPlatform(SYSTEM, (tx) =>
      sendPlatformJob(tx, org, Q, { payload: { fanout: true } }),
    );
    expect((await jobs(Q)).find((j) => j.id === id)).toMatchObject({ state: 'queued' });
    await drain({ platform, handlers: { [Q]: async () => undefined } });
  });

  it('rejects payloads that are not small id-only objects and bad queue names', async () => {
    await expect(
      tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, 'Bad Queue', {})),
    ).rejects.toThrow(/queue name/);
    await expect(
      tenant.withTenant(org, SYSTEM, (tx) =>
        sendJob(tx, Q, { payload: { big: 'x'.repeat(9000) } }),
      ),
    ).rejects.toThrow();
  });

  const sqlState = async (promise: Promise<unknown>): Promise<string | undefined> => {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      return e.code ?? e.cause?.code;
    }
    return undefined;
  };

  it('accepts only registered kinds, and only tenant-enqueueable ones from a tenant (S5)', async () => {
    expect(
      await sqlState(tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, 'test.unknown'))),
    ).toBe('22023');
    expect(
      await sqlState(tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, 'test.platform_only'))),
    ).toBe('42501');
    expect(
      await sqlState(
        platform.withPlatform(SYSTEM, (tx) => sendPlatformJob(tx, org, 'test.unknown')),
      ),
    ).toBe('22023');
    const id = await platform.withPlatform(SYSTEM, (tx) =>
      sendPlatformJob(tx, org, 'test.platform_only', { payload: { n: 1 } }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await admin.query(`DELETE FROM platform.job WHERE id = $1`, [id]);
  });

  it('takes the actor label and attempt limit from the registry, never from the tenant (S5)', async () => {
    const id = await tenant.withTenant(org, SYSTEM, (tx) =>
      sendJob(tx, Q, { payload: { n: 9 }, maxAttempts: 25 }),
    );
    const row = (
      await admin.query(`SELECT actor_label, max_attempts FROM platform.job WHERE id = $1`, [id])
    ).rows[0];
    expect(row).toEqual({ actor_label: 'test echo', max_attempts: 5 });
    // A lower limit is honored; the platform may label its own fan-out.
    const low = await platform.withPlatform(SYSTEM, (tx) =>
      sendPlatformJob(tx, org, Q, { maxAttempts: 2, actorLabel: 'nightly fan-out' }),
    );
    const lowRow = (
      await admin.query(`SELECT actor_label, max_attempts FROM platform.job WHERE id = $1`, [low])
    ).rows[0];
    expect(lowRow).toEqual({ actor_label: 'nightly fan-out', max_attempts: 2 });
    await admin.query(`DELETE FROM platform.job WHERE id = ANY($1::uuid[])`, [[id, low]]);
  });

  it('refuses run_after in the past and payload keys outside the registry (S5)', async () => {
    const past = new Date(Date.now() - 60_000);
    expect(
      await sqlState(tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q, { runAfter: past }))),
    ).toBe('22023');
    // Unregistered key, a platform-only key from a tenant, and a nested value.
    expect(
      await sqlState(
        tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q, { payload: { email: 'x' } })),
      ),
    ).toBe('22023');
    expect(
      await sqlState(
        tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q, { payload: { fanout: true } })),
      ),
    ).toBe('22023');
    const nested = { n: { deep: 1 } } as unknown as Record<string, number>;
    expect(
      await sqlState(tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, Q, { payload: nested }))),
    ).toBe('22023');
    // A tenant never asks for a snapshot, even on the real recompute kind.
    expect(
      await sqlState(
        tenant.withTenant(org, SYSTEM, (tx) =>
          sendJob(tx, 'readiness.recompute', { payload: { snapshot: true } }),
        ),
      ),
    ).toBe('22023');
  });

  it('caps queued jobs per tenant and kind (S5)', async () => {
    await tenant.withTenant(org, SYSTEM, async (tx) => {
      await sendJob(tx, 'test.capped');
      await sendJob(tx, 'test.capped');
    });
    expect(await sqlState(tenant.withTenant(org, SYSTEM, (tx) => sendJob(tx, 'test.capped')))).toBe(
      '54000',
    );
    // Coalesced sends do not count against the cap.
    await admin.query(`DELETE FROM platform.job WHERE queue = 'test.capped'`);
    await tenant.withTenant(org, SYSTEM, async (tx) => {
      for (let i = 0; i < 5; i += 1) await sendJob(tx, 'test.capped', { singletonKey: 'same' });
    });
    expect((await jobs('test.capped')).filter((j) => j.state === 'queued')).toHaveLength(1);
    await admin.query(`DELETE FROM platform.job WHERE queue = 'test.capped'`);
  });

  it('purges finished run records past the retention age, and never below one day (S5)', async () => {
    const old = await platform.withPlatform(SYSTEM, (tx) =>
      sendPlatformJob(tx, org, Q, { payload: { n: 70 } }),
    );
    const recent = await platform.withPlatform(SYSTEM, (tx) =>
      sendPlatformJob(tx, org, Q, { payload: { n: 71 } }),
    );
    await admin.query(
      `UPDATE platform.job SET state = 'completed', finished_at = now() - interval '400 days'
       WHERE id = $1`,
      [old],
    );
    await admin.query(
      `UPDATE platform.job SET state = 'completed', finished_at = now() WHERE id = $1`,
      [recent],
    );
    expect(
      await sqlState(
        platform.withPlatform(SYSTEM, (tx) =>
          tx.execute(sql`SELECT platform.purge_finished_jobs(interval '1 hour')`),
        ),
      ),
    ).toBe('22023');
    const purged = await platform.withPlatform(SYSTEM, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`SELECT platform.purge_finished_jobs(interval '365 days') AS n`,
      );
      return r.rows[0]!.n;
    });
    expect(purged).toBeGreaterThanOrEqual(1);
    const left = (await jobs(Q)).map((j) => j.id);
    expect(left).not.toContain(old);
    expect(left).toContain(recent);
    // The tenant role cannot purge.
    const user = await connect(need().appUserUrl);
    try {
      await expectPgError(
        user.query(`SELECT platform.purge_finished_jobs(interval '1 day')`),
        '42501',
      );
    } finally {
      await user.end();
    }
  });
});
