/**
 * The readiness service end to end on PostgreSQL (G1-8, G1-1, G1-3): recompute enqueued in
 * the transaction of each change and drained by drain(); statuses in each site's time
 * zone; audit events for N/A, parameters, facts, and evaluations; human-only N/A and
 * parameters (AI never attests); tenant isolation; snapshots pinned to catalogVersion.
 */
import { fixedClock, parseInstant } from '@deemed/dates';
import type { Actor, TransactionContext, Tx } from '@deemed/db';
import { drain } from '@deemed/jobs';
import {
  RECOMPUTE_QUEUE,
  ReadinessError,
  clearNotApplicable,
  enqueueNightlySweep,
  markNotApplicable,
  publishCatalogBundle,
  recomputeHandler,
  recomputeTenant,
  recordFact,
  retractFact,
  setTenantParameter,
} from '@deemed/readiness/service';
import { fxCatV2 } from '@deemed/test-fixtures/catalog';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb, expectPgError } from '../../db/test/helpers.js';
import {
  SYSTEM,
  fxBundles,
  nextCatalogVersion,
  pgError,
  startWorld,
  type TestOrg,
  type World,
} from './world.js';

const NA_REASON = 'Synthetic: this practitioner does not prescribe controlled substances';
const TODAY = '2026-09-29T15:00:00Z';

describeDb('readiness service and recompute job', () => {
  let w: World;
  let v1: string;
  let v1Release: string;

  beforeAll(async () => {
    w = await startWorld();
    v1 = await nextCatalogVersion(w.admin);
    v1Release = (
      await w.platform.withPlatform(SYSTEM, (tx) =>
        publishCatalogBundle(tx, fxBundles(v1).nonProduction, 'readiness test'),
      )
    ).releaseId;
  });

  afterAll(async () => {
    await w?.close();
  });

  const mine = () => new Set([w.a.id, w.b.id]);
  /** drain() with the real handler, limited to this file's tenants. */
  const drainAt = (asOf: string) => {
    const handler = recomputeHandler(w.tenant, fixedClock(parseInstant(asOf)));
    return drain({
      platform: w.platform,
      handlers: {
        [RECOMPUTE_QUEUE]: async (job) => {
          if (job.organizationId && mine().has(job.organizationId)) await handler(job);
        },
      },
    });
  };
  const asHuman = <T>(org: TestOrg, fn: (tx: Tx, ctx: TransactionContext) => Promise<T>) =>
    w.tenant.withTenant(org.id, w.human(org), fn);
  const asActor = <T>(
    org: TestOrg,
    actor: Actor,
    fn: (tx: Tx, ctx: TransactionContext) => Promise<T>,
  ) => w.tenant.withTenant(org.id, actor, fn);
  const queued = async (org: TestOrg) =>
    (
      await w.admin.query(
        `SELECT id FROM platform.job WHERE queue = $1 AND organization_id = $2 AND state = 'queued'`,
        [RECOMPUTE_QUEUE, org.id],
      )
    ).rowCount;
  const instance = async (id: string) =>
    (
      await w.admin.query(
        `SELECT status, next_due_on::text, status_reasons, catalog_release_id::text, requirement_version_id::text,
                not_applicable_reason, not_applicable_by::text, row_version
         FROM public.requirement_instance WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const audit = async (org: TestOrg, action?: string) =>
    (
      await w.admin.query(
        `SELECT action, category, actor_type, actor_user_id::text, target_id::text, reason, diff, metadata,
                requirement_ids
         FROM audit.audit_event WHERE organization_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY chain_seq`,
        [org.id, action ?? null],
      )
    ).rows;
  const integration: Actor = { type: 'integration', label: 'Synthetic license board sync' };
  const assistant = (org: TestOrg): Actor => ({
    type: 'service',
    label: 'Deemed Assistant',
    onBehalfOfId: org.userId,
  });

  it('enqueues the recompute in the same transaction as the change (none if it rolls back)', async () => {
    await expect(
      asHuman(w.a, async (tx, ctx) => {
        await markNotApplicable(tx, ctx, { instanceId: w.a.instances.deaE, reason: NA_REASON });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await queued(w.a)).toBe(0);
    expect((await instance(w.a.instances.deaE)).not_applicable_reason).toBeNull();

    await asHuman(w.a, (tx, ctx) =>
      markNotApplicable(tx, ctx, { instanceId: w.a.instances.deaE, reason: NA_REASON }),
    );
    // A second change in its own transaction coalesces into the same queued job.
    await asHuman(w.a, (tx, ctx) =>
      setTenantParameter(tx, ctx, {
        requirementId: 'TEST-05-PRIV',
        key: 'reprivilegingIntervalMonths',
        value: 12,
        reason: 'Synthetic: our C&P procedures re-privilege every year',
      }),
    );
    expect(await queued(w.a)).toBe(1);
  });

  it('records evidence facts from people and integrations, each enqueuing a recompute', async () => {
    const facts: [string, Parameters<typeof recordFact>[2], Actor][] = [
      [
        'licenseE',
        {
          instanceId: w.a.instances.licenseE,
          kind: 'expiration',
          effectiveOn: '2025-07-01',
          expiresOn: '2027-06-30',
        },
        integration,
      ],
      [
        'licenseC',
        {
          instanceId: w.a.instances.licenseC,
          kind: 'expiration',
          effectiveOn: '2025-07-01',
          expiresOn: '2027-06-30',
        },
        integration,
      ],
      [
        'budget',
        {
          instanceId: w.a.instances.budget,
          kind: 'approval',
          effectiveOn: '2025-10-01',
          approval: { capacity: 'board', decision: 'approved', approvalTypeId: 'budget.annual' },
        },
        w.human(w.a),
      ],
      [
        'meetings',
        { instanceId: w.a.instances.meetings, kind: 'completion', effectiveOn: '2026-09-10' },
        w.human(w.a),
      ],
      [
        'procedures',
        { instanceId: w.a.instances.procedures, kind: 'document', effectiveOn: '2026-03-01' },
        w.human(w.a),
      ],
      [
        'priv',
        {
          instanceId: w.a.instances.priv,
          kind: 'approval',
          effectiveOn: '2025-08-31',
          approval: {
            capacity: 'designated',
            decision: 'approved',
            approvalTypeId: 'cp.privileges.grant',
          },
        },
        w.human(w.a),
      ],
    ];
    for (const [, input, actor] of facts) {
      await asActor(w.a, actor, (tx, ctx) => recordFact(tx, ctx, input));
    }
    expect(await queued(w.a)).toBe(1);
    const events = await audit(w.a, 'readiness_fact.record');
    expect(events).toHaveLength(facts.length);
    expect(events[0]).toMatchObject({ actor_type: 'integration', actor_user_id: null });
  });

  it('drains the job: every instance evaluated in its site zone, pinned to the catalog release', async () => {
    const result = await drainAt(TODAY);
    expect(result.runs.filter((r) => r.outcome !== 'completed')).toEqual([]);
    expect(await queued(w.a)).toBe(0);
    const i = w.a.instances;
    expect(await instance(i.licenseE)).toMatchObject({
      status: 'met',
      next_due_on: '2027-06-30',
      catalog_release_id: v1Release,
    });
    expect((await instance(i.licenseE)).requirement_version_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await instance(i.deaE)).toMatchObject({
      status: 'not_applicable',
      not_applicable_by: w.a.userId,
    });
    expect(await instance(i.budget)).toMatchObject({
      status: 'due_soon',
      next_due_on: '2026-10-01',
    });
    expect(await instance(i.meetings)).toMatchObject({ status: 'met', next_due_on: '2026-10-31' });
    expect(await instance(i.procedures)).toMatchObject({ status: 'met', next_due_on: null });
    // Tenant parameter 12 months from 2025-08-31: due 2026-08-31, overdue today.
    expect(await instance(i.priv)).toMatchObject({ status: 'overdue', next_due_on: '2026-08-31' });
    expect((await instance(i.priv)).status_reasons.map((r: { code: string }) => r.code)).toEqual([
      'evidence_on_file',
      'past_due',
    ]);
  });

  it('evaluates Eastern and Central sites in their own zones (FX-DATE-TZ-E, FX-DATE-TZ-C)', async () => {
    // 2027-07-01T04:30Z: 00:30 on July 1 in Tampa, 23:30 on June 30 in Pensacola.
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant('2027-07-01T04:30:00Z') });
    expect(await instance(w.a.instances.licenseE)).toMatchObject({ status: 'overdue' });
    expect(await instance(w.a.instances.licenseC)).toMatchObject({ status: 'due_soon' });
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant('2027-07-01T05:00:00Z') });
    expect(await instance(w.a.instances.licenseC)).toMatchObject({ status: 'overdue' });
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant(TODAY) });
    expect(await instance(w.a.instances.licenseE)).toMatchObject({ status: 'met' });
  });

  it('is idempotent: recomputing again changes nothing and writes no audit event', async () => {
    const before = (await audit(w.a)).length;
    const again = await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant(TODAY) });
    expect(again).toMatchObject({ changed: 0, evaluated: 7 });
    expect((await audit(w.a)).length).toBe(before);
  });

  it('audits N/A, parameter, and evaluation changes, with free text redacted', async () => {
    const [na] = await audit(w.a, 'requirement_instance.mark_not_applicable');
    expect(na).toMatchObject({
      category: 'mutation',
      actor_type: 'user',
      actor_user_id: w.a.userId,
      target_id: w.a.instances.deaE,
      requirement_ids: ['TEST-05-DEA'],
    });
    expect(na.diff.fields.not_applicable_reason.after).toMatchObject({
      redacted: true,
      length: NA_REASON.length,
    });
    const [param] = await audit(w.a, 'tenant_parameter.set');
    expect(param).toMatchObject({ actor_type: 'user', requirement_ids: ['TEST-05-PRIV'] });
    expect(param.diff.fields.value).toEqual({ before: null, after: 12 });
    expect(param.diff.fields.reason.after).toMatchObject({ redacted: true });
    const evals = await audit(w.a, 'requirement_instance.evaluate');
    expect(evals.length).toBeGreaterThanOrEqual(7);
    expect(evals[0]).toMatchObject({
      actor_type: 'system',
      metadata: { catalogVersion: v1, label: 'internal_readiness_not_hrsa_determination' },
    });
    expect(await audit(w.a, 'catalog_release.applied')).toHaveLength(1);
    // The words of a free-text reason never reach the log.
    expect(JSON.stringify(await audit(w.a))).not.toContain('controlled substances');
    // The chain still verifies.
    const chain = await w.admin.query('SELECT ok FROM audit.verify_chain($1)', [w.a.id]);
    expect(chain.rows[0].ok).toBe(true);
  });

  it('never lets a service (AI) actor attest: N/A, parameters, and facts need a person (or an integration for facts)', async () => {
    const ai = assistant(w.a);
    await expect(
      asActor(w.a, ai, (tx, ctx) =>
        markNotApplicable(tx, ctx, { instanceId: w.a.instances.licenseE, reason: 'drafted by AI' }),
      ),
    ).rejects.toMatchObject({ code: 'human_actor_required' });
    await expect(
      asActor(w.a, ai, (tx, ctx) =>
        setTenantParameter(tx, ctx, {
          requirementId: 'TEST-05-PRIV',
          key: 'reprivilegingIntervalMonths',
          value: 6,
          reason: 'AI',
        }),
      ),
    ).rejects.toMatchObject({ code: 'human_actor_required' });
    await expect(
      asActor(w.a, ai, (tx, ctx) =>
        recordFact(tx, ctx, {
          instanceId: w.a.instances.procedures,
          kind: 'document',
          effectiveOn: '2026-09-01',
        }),
      ),
    ).rejects.toMatchObject({ code: 'actor_not_allowed' });
    // The database refuses the same writes from a non-human transaction.
    expect(
      await pgError(
        asActor(w.a, ai, (tx) =>
          tx.execute(sql`UPDATE public.requirement_instance SET status = 'not_applicable',
                         not_applicable_reason = 'AI' WHERE id = ${w.a.instances.licenseC}::uuid`),
        ),
      ),
    ).toMatchObject({ code: '42501' });
    expect(
      await pgError(
        asActor(w.a, SYSTEM, (tx) =>
          tx.execute(sql`INSERT INTO public.tenant_parameter (organization_id, requirement_id, parameter_key, value, reason)
                         VALUES (${w.a.id}::uuid, 'TEST-05-PRIV', 'other', 1, 'system')`),
        ),
      ),
    ).toMatchObject({ code: '42501' });
    expect(
      await pgError(
        asActor(w.a, SYSTEM, (tx) =>
          tx.execute(sql`INSERT INTO public.readiness_fact (organization_id, requirement_instance_id, kind, effective_on, recorded_by_type)
                         VALUES (${w.a.id}::uuid, ${w.a.instances.procedures}::uuid, 'document', DATE '2026-09-01', 'user')`),
        ),
      ),
    ).toMatchObject({ code: '42501' });
  });

  it('allows N/A only where the catalog does, with a reason, once; clearing needs a reason and is audited', async () => {
    const err = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: ReadinessError) => e.code,
      );
    expect(
      await err(
        asHuman(w.a, (tx, ctx) =>
          markNotApplicable(tx, ctx, { instanceId: w.a.instances.licenseE, reason: 'x' }),
        ),
      ),
    ).toBe('not_applicable_not_allowed');
    expect(
      await err(
        asHuman(w.a, (tx, ctx) =>
          markNotApplicable(tx, ctx, { instanceId: w.a.instances.deaE, reason: '   ' }),
        ),
      ),
    ).toBe('invalid_reason');
    expect(
      await err(
        asHuman(w.a, (tx, ctx) =>
          markNotApplicable(tx, ctx, { instanceId: w.a.instances.deaE, reason: 'again' }),
        ),
      ),
    ).toBe('already_not_applicable');
    const row = await instance(w.a.instances.deaE);
    expect(
      await err(
        asHuman(w.a, (tx, ctx) =>
          clearNotApplicable(tx, ctx, {
            instanceId: w.a.instances.deaE,
            reason: 'x',
            expectedRowVersion: row.row_version - 1,
          }),
        ),
      ),
    ).toBe('version_conflict');
    await asHuman(w.a, (tx, ctx) =>
      clearNotApplicable(tx, ctx, {
        instanceId: w.a.instances.deaE,
        reason: 'Synthetic: now prescribes',
        expectedRowVersion: row.row_version,
      }),
    );
    const [cleared] = await audit(w.a, 'requirement_instance.clear_not_applicable');
    expect(cleared).toMatchObject({ actor_type: 'user', reason: 'Synthetic: now prescribes' });
    await drainAt(TODAY);
    // No DEA evidence on file: the engine now says missing.
    expect(await instance(w.a.instances.deaE)).toMatchObject({
      status: 'missing',
      not_applicable_reason: null,
      not_applicable_by: null,
    });
  });

  it('keeps tenant parameters inside the catalog bounds', async () => {
    const err = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: ReadinessError) => e.code,
      );
    const set = (
      value: number,
      key = 'reprivilegingIntervalMonths',
      requirementId = 'TEST-05-PRIV',
    ) =>
      err(
        asHuman(w.a, (tx, ctx) =>
          setTenantParameter(tx, ctx, { requirementId, key, value, reason: 'Synthetic' }),
        ),
      );
    expect(await set(30)).toBe('parameter_out_of_bounds');
    expect(await set(0)).toBe('parameter_out_of_bounds');
    expect(await set(12, 'unknownKey')).toBe('parameter_unknown');
    expect(await set(12, 'reprivilegingIntervalMonths', 'TEST-99-NOT-IN-CATALOG')).toBe(
      'not_in_catalog',
    );
    expect(await set(24)).toBeNull();
    await drainAt(TODAY);
    // 24 months from 2025-08-31: due 2027-08-31.
    expect(await instance(w.a.instances.priv)).toMatchObject({
      status: 'met',
      next_due_on: '2027-08-31',
    });
  });

  it('retracting evidence is human-only, audited, and re-evaluates', async () => {
    const fact = (
      await w.admin.query(
        `SELECT id::text FROM public.readiness_fact WHERE requirement_instance_id = $1`,
        [w.a.instances.procedures],
      )
    ).rows[0].id as string;
    await expect(
      asActor(w.a, integration, (tx, ctx) =>
        retractFact(tx, ctx, { factId: fact, reason: 'sync' }),
      ),
    ).rejects.toMatchObject({ code: 'human_actor_required' });
    await asHuman(w.a, (tx, ctx) =>
      retractFact(tx, ctx, { factId: fact, reason: 'Synthetic: wrong document attached' }),
    );
    await expect(
      asHuman(w.a, (tx, ctx) => retractFact(tx, ctx, { factId: fact, reason: 'again' })),
    ).rejects.toMatchObject({ code: 'fact_retracted' });
    await drainAt(TODAY);
    expect(await instance(w.a.instances.procedures)).toMatchObject({ status: 'missing' });
    // A fact is never edited in place.
    expect(
      await pgError(
        asHuman(w.a, (tx) =>
          tx.execute(sql`UPDATE public.readiness_fact SET effective_on = DATE '2020-01-01'
                         WHERE requirement_instance_id = ${w.a.instances.licenseE}::uuid`),
        ),
      ),
    ).toMatchObject({ code: '23514' });
  });

  it('isolates tenants: one tenant cannot act on, or be changed by, another', async () => {
    await expect(
      asHuman(w.b, (tx, ctx) =>
        markNotApplicable(tx, ctx, { instanceId: w.a.instances.deaE, reason: 'cross-tenant' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      asActor(w.b, integration, (tx, ctx) =>
        recordFact(tx, ctx, {
          instanceId: w.a.instances.procedures,
          kind: 'document',
          effectiveOn: '2026-01-01',
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const bBefore = await w.admin.query(
      `SELECT id, status, row_version FROM public.requirement_instance WHERE organization_id = $1 ORDER BY id`,
      [w.b.id],
    );
    const bChain = (await audit(w.b)).length;
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant('2027-07-01T04:30:00Z') });
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant(TODAY) });
    const bAfter = await w.admin.query(
      `SELECT id, status, row_version FROM public.requirement_instance WHERE organization_id = $1 ORDER BY id`,
      [w.b.id],
    );
    expect(bAfter.rows).toEqual(bBefore.rows);
    expect((await audit(w.b)).length).toBe(bChain);
    // A tenant's job carries only its id, and the handler runs under that tenant alone.
    await asHuman(w.b, (tx, ctx) =>
      recordFact(tx, ctx, {
        instanceId: w.b.instances.procedures,
        kind: 'document',
        effectiveOn: '2026-02-01',
      }),
    );
    const jobs = await w.admin.query(
      `SELECT organization_id::text, payload FROM platform.job WHERE queue = $1 AND state = 'queued' AND organization_id = ANY($2)`,
      [RECOMPUTE_QUEUE, [w.a.id, w.b.id]],
    );
    expect(jobs.rows).toEqual([{ organization_id: w.b.id, payload: { cause: 'readiness_fact' } }]);
    await drainAt(TODAY);
    expect(await instance(w.b.instances.procedures)).toMatchObject({ status: 'met' });
  });

  it('stores one nightly snapshot per tenant and day, pinned to its catalog version; a new version never rewrites it (FX-CAT-SNAPSHOT, FX-CAT-CHANGE)', async () => {
    const sweep = () =>
      w.platform.withPlatform(SYSTEM, (tx) => enqueueNightlySweep(tx, parseInstant(TODAY)));
    expect(await sweep()).toBeGreaterThanOrEqual(2);
    await drainAt(TODAY);
    await sweep();
    await drainAt(TODAY);
    const snaps = async () =>
      (
        await w.admin.query(
          `SELECT id::text, catalog_version, as_of_date::text, kind, met, denominator, body
           FROM public.readiness_snapshot WHERE organization_id = $1 ORDER BY catalog_version, as_of_date`,
          [w.a.id],
        )
      ).rows;
    const first = await snaps();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      catalog_version: v1,
      as_of_date: '2026-09-29',
      kind: 'nightly',
    });
    expect(first[0].body.label).toBe('internal_readiness_not_hrsa_determination');
    expect(first[0].body.items).toHaveLength(7);
    expect(await audit(w.a, 'readiness_snapshot.create')).toHaveLength(1);

    // FX-CAT-CHANGE: v2 retires TEST-05-PROCEDURES and moves the budget to 24 months.
    const v2 = await nextCatalogVersion(w.admin);
    await w.platform.withPlatform(SYSTEM, (tx) =>
      publishCatalogBundle(tx, fxBundles(v2, fxCatV2()).nonProduction, 'readiness test'),
    );
    await sweep();
    await drainAt(TODAY);
    const after = await snaps();
    expect(after.map((s) => s.catalog_version)).toEqual([v1, v2]);
    expect(after[0]).toEqual(first[0]);
    expect(await instance(w.a.instances.procedures)).toMatchObject({ status: 'not_assessed' });
    expect(await instance(w.a.instances.budget)).toMatchObject({
      status: 'met',
      next_due_on: '2027-10-01',
    });
    // A snapshot is never edited, whoever tries.
    await expectPgError(
      w.admin.query(`UPDATE public.readiness_snapshot SET met = 0 WHERE id = $1`, [first[0].id]),
      '42501',
    );
  });
});
