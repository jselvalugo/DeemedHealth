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
import { FX_CAT_ENTRIES, fxCatV2 } from '@deemed/test-fixtures/catalog';
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
const TODAY = '2030-09-29T15:00:00Z';

describeDb('readiness service and recompute job', () => {
  let w: World;
  let v1: string;
  /** The latest release this file published (other tests publish more). */
  let latest: string;
  let v1Release: string;

  beforeAll(async () => {
    w = await startWorld();
    v1 = await nextCatalogVersion(w.admin);
    v1Release = (
      await w.platform.withPlatform(SYSTEM, (tx) =>
        publishCatalogBundle(tx, fxBundles(v1).nonProduction, 'readiness test'),
      )
    ).releaseId;
    latest = v1;
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
          effectiveOn: '2029-07-01',
          expiresOn: '2031-06-30',
        },
        integration,
      ],
      [
        'licenseC',
        {
          instanceId: w.a.instances.licenseC,
          kind: 'expiration',
          effectiveOn: '2029-07-01',
          expiresOn: '2031-06-30',
        },
        integration,
      ],
      [
        'meetings',
        { instanceId: w.a.instances.meetings, kind: 'completion', effectiveOn: '2030-09-10' },
        w.human(w.a),
      ],
      [
        'procedures',
        { instanceId: w.a.instances.procedures, kind: 'document', effectiveOn: '2030-03-01' },
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
    // The diff names who recorded it and the (empty) approval and evidence links (S11).
    expect(Object.keys(events[0].diff.fields).sort()).toEqual(
      ['effective_on', 'expires_on', 'kind', 'recorded_by_type', 'requirement_instance_id'].sort(),
    );
    expect(events[0].diff.fields.recorded_by_type).toEqual({ before: null, after: 'integration' });
  });

  it('refuses approval facts until S5, integration approvals always, and integration documents until S6 (F3, S2)', async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: ReadinessError) => e.code,
      );
    const approvalFact = {
      instanceId: w.a.instances.budget,
      kind: 'approval' as const,
      effectiveOn: '2029-10-01',
    };
    expect(await code(asHuman(w.a, (tx, ctx) => recordFact(tx, ctx, approvalFact)))).toBe(
      'approval_facts_unavailable',
    );
    expect(
      await code(asActor(w.a, integration, (tx, ctx) => recordFact(tx, ctx, approvalFact))),
    ).toBe('actor_not_allowed');
    expect(
      await code(
        asActor(w.a, integration, (tx, ctx) =>
          recordFact(tx, ctx, {
            instanceId: w.a.instances.procedures,
            kind: 'document',
            effectiveOn: '2030-03-01',
          }),
        ),
      ),
    ).toBe('actor_not_allowed');
    // The database refuses them too, whatever the input says.
    // A real, human-recorded approval exists; the fact is still refused (no capacity or type
    // on public.approval to copy).
    const approvalId = await asHuman(w.a, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO public.approval (organization_id, subject_type, subject_id, approver_person_id,
                                     approver_user_account_id, decision)
        VALUES (${w.a.id}::uuid, 'requirement_instance', ${w.a.instances.budget}::uuid,
                ${w.a.personE}::uuid, ${w.a.userId}::uuid, 'approved')
        RETURNING id::text`);
      return r.rows[0]?.id as string;
    });
    expect(
      await pgError(
        asHuman(w.a, (tx) =>
          tx.execute(sql`INSERT INTO public.readiness_fact (organization_id, requirement_instance_id, kind, effective_on,
                           approval_id, approval_capacity, approval_decision, approval_type_id, recorded_by_type)
                         VALUES (${w.a.id}::uuid, ${w.a.instances.budget}::uuid, 'approval', DATE '2029-10-01',
                                 ${approvalId}::uuid, 'board', 'approved', 'budget.annual', 'user')`),
        ),
      ),
    ).toMatchObject({ code: '0A000' });
    // Untyped, wildcard, or unlinked approval rows are rejected by the table checks (F2).
    for (const [type, link] of [
      [null, approvalId],
      ['budget.*', approvalId],
      ['budget.annual', null],
    ] as const) {
      expect(
        await pgError(
          asHuman(w.a, (tx) =>
            tx.execute(sql`INSERT INTO public.readiness_fact (organization_id, requirement_instance_id, kind, effective_on,
                             approval_id, approval_capacity, approval_decision, approval_type_id, recorded_by_type)
                           VALUES (${w.a.id}::uuid, ${w.a.instances.budget}::uuid, 'approval', DATE '2029-10-01',
                                   ${link}::uuid, 'board', 'approved', ${type}, 'user')`),
          ),
        ),
      ).toMatchObject({ code: '23514' });
    }
    // recorded_by_type must be the transaction's actor type, and service actors never write (S3).
    expect(
      await pgError(
        asActor(w.a, assistant(w.a), (tx) =>
          tx.execute(sql`INSERT INTO public.readiness_fact (organization_id, requirement_instance_id, kind, effective_on, recorded_by_type)
                         VALUES (${w.a.id}::uuid, ${w.a.instances.procedures}::uuid, 'completion', DATE '2030-03-01', 'integration')`),
        ),
      ),
    ).toMatchObject({ code: '42501' });
    expect(
      await pgError(
        asActor(w.a, integration, (tx) =>
          tx.execute(sql`INSERT INTO public.readiness_fact (organization_id, requirement_instance_id, kind, effective_on, recorded_by_type)
                         VALUES (${w.a.id}::uuid, ${w.a.instances.procedures}::uuid, 'completion', DATE '2030-03-01', 'user')`),
        ),
      ),
    ).toMatchObject({ code: '42501' });
  });

  it('drains the job: every instance evaluated in its site zone, pinned to the catalog release', async () => {
    const result = await drainAt(TODAY);
    expect(result.runs.filter((r) => r.outcome !== 'completed')).toEqual([]);
    expect(await queued(w.a)).toBe(0);
    const i = w.a.instances;
    expect(await instance(i.licenseE)).toMatchObject({
      status: 'met',
      next_due_on: '2031-06-30',
      catalog_release_id: v1Release,
    });
    expect((await instance(i.licenseE)).requirement_version_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await instance(i.deaE)).toMatchObject({
      status: 'not_applicable',
      not_applicable_by: w.a.userId,
    });
    // Board-approval-backed and approval-backed items have no qualifying evidence until S5.
    expect(await instance(i.budget)).toMatchObject({ status: 'missing', next_due_on: null });
    expect(await instance(i.meetings)).toMatchObject({ status: 'met', next_due_on: '2030-10-31' });
    expect(await instance(i.procedures)).toMatchObject({ status: 'met', next_due_on: null });
    expect(await instance(i.priv)).toMatchObject({ status: 'missing', next_due_on: null });
    expect((await instance(i.priv)).status_reasons.map((r: { code: string }) => r.code)).toEqual([
      'no_evidence',
    ]);
  });

  it('evaluates Eastern and Central sites in their own zones (FX-DATE-TZ-E, FX-DATE-TZ-C)', async () => {
    // 2031-07-01T04:30Z: 00:30 on July 1 in Tampa, 23:30 on June 30 in Pensacola.
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant('2031-07-01T04:30:00Z') });
    expect(await instance(w.a.instances.licenseE)).toMatchObject({ status: 'overdue' });
    expect(await instance(w.a.instances.licenseC)).toMatchObject({ status: 'due_soon' });
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant('2031-07-01T05:00:00Z') });
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
          effectiveOn: '2030-09-01',
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
                         VALUES (${w.a.id}::uuid, ${w.a.instances.procedures}::uuid, 'document', DATE '2030-09-01', 'user')`),
        ),
      ),
    ).toMatchObject({ code: '42501' });
  });

  it("never clears a person's N/A mark: a release without the entry leaves it intact, a catalog that disallows N/A flags it, and republishing restores it (F1)", async () => {
    const id = w.a.instances.deaE;
    const mark = async () =>
      (
        await w.admin.query(
          `SELECT not_applicable_reason, not_applicable_by::text, not_applicable_at,
                  not_applicable_superseded_at, not_applicable_superseded_catalog_version
           FROM public.requirement_instance WHERE id = $1`,
          [id],
        )
      ).rows[0];
    const original = await mark();
    expect(original.not_applicable_reason).toBe(NA_REASON);
    const publish = async (entries: Record<string, unknown>[]) => {
      latest = await nextCatalogVersion(w.admin);
      await w.platform.withPlatform(SYSTEM, (tx) =>
        publishCatalogBundle(tx, fxBundles(latest, entries).nonProduction, 'readiness test'),
      );
      await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant(TODAY) });
      return latest;
    };
    const all = Object.values(FX_CAT_ENTRIES) as Record<string, unknown>[];

    // 1. A release without the entry: not assessed, and the mark is left completely alone.
    await publish(all.filter((e) => e.id !== 'TEST-05-DEA'));
    expect(await instance(id)).toMatchObject({ status: 'not_assessed' });
    expect(await mark()).toEqual(original);
    expect(await audit(w.a, 'requirement_instance.clear_not_applicable')).toEqual([]);

    // 2. A release that no longer allows N/A: the mark is kept, flagged, and the status is
    //    computed normally (no DEA evidence on file: missing).
    const disallowing = await publish(
      all.map((e) => (e.id === 'TEST-05-DEA' ? { ...e, notApplicable: { allowed: false } } : e)),
    );
    const flagged = await mark();
    expect(flagged).toMatchObject({
      not_applicable_reason: NA_REASON,
      not_applicable_by: original.not_applicable_by,
      not_applicable_at: original.not_applicable_at,
      not_applicable_superseded_catalog_version: disallowing,
    });
    expect(flagged.not_applicable_superseded_at).toBeInstanceOf(Date);
    const row = await instance(id);
    expect(row.status).toBe('missing');
    expect(row.status_reasons.map((r: { code: string }) => r.code)).toContain(
      'na_superseded_needs_review',
    );
    // Neither the engine nor any system job can clear a mark.
    expect(
      await pgError(
        w.tenant.withTenant(w.a.id, SYSTEM, (tx) =>
          tx.execute(sql`UPDATE public.requirement_instance SET not_applicable_reason = NULL
                         WHERE id = ${id}::uuid`),
        ),
      ),
    ).toMatchObject({ code: '42501' });

    // 3. Republished with N/A allowed: the same mark applies again, flag cleared.
    await publish(all);
    expect(await instance(id)).toMatchObject({ status: 'not_applicable' });
    expect(await mark()).toEqual(original);
  });

  it('takes the as-of instant from the database clock when none is given, so a fresh mark is never "in the future" (S7)', async () => {
    await asHuman(w.b, (tx, ctx) =>
      markNotApplicable(tx, ctx, { instanceId: w.b.instances.deaE, reason: NA_REASON }),
    );
    const summary = await recomputeTenant(w.tenant, w.b.id, {});
    expect(summary.evaluated).toBe(7);
    expect(await instance(w.b.instances.deaE)).toMatchObject({
      status: 'not_applicable',
      not_applicable_reason: NA_REASON,
    });
    // An as-of instant before the mark ignores it for that evaluation but never clears it.
    await recomputeTenant(w.tenant, w.b.id, { asOf: parseInstant('2020-01-01T12:00:00Z') });
    expect(await instance(w.b.instances.deaE)).toMatchObject({ not_applicable_reason: NA_REASON });
    await recomputeTenant(w.tenant, w.b.id, {});
    expect(await instance(w.b.instances.deaE)).toMatchObject({ status: 'not_applicable' });
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
    // Nothing SSN-shaped is stored (D1): the service refuses it, and so does the table (S8).
    const ssnLike = ['900', '12', '3456'].join('-');
    expect(
      await err(
        asHuman(w.a, (tx, ctx) =>
          markNotApplicable(tx, ctx, {
            instanceId: w.a.instances.licenseC,
            reason: `x ${ssnLike}`,
          }),
        ),
      ),
    ).toBe('invalid_reason');
    expect(
      await pgError(
        asHuman(w.a, (tx) =>
          tx.execute(sql`UPDATE public.tenant_parameter SET reason = ${`x ${ssnLike}`}
                         WHERE organization_id = ${w.a.id}::uuid`),
        ),
      ),
    ).toMatchObject({ code: '23514' });
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
    // The words stay out of the log: only the redacted diff records the change (S1).
    expect(cleared).toMatchObject({ actor_type: 'user', reason: null });
    expect(cleared.diff.fields.not_applicable_reason.before).toMatchObject({ redacted: true });
    expect(JSON.stringify(cleared)).not.toContain('now prescribes');
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
    const [stored] = (
      await w.admin.query(
        `SELECT value FROM public.tenant_parameter WHERE organization_id = $1 AND requirement_id = 'TEST-05-PRIV'`,
        [w.a.id],
      )
    ).rows;
    expect(stored.value).toBe(24);
    await drainAt(TODAY);
    // No approval evidence can exist until S5: still missing (engine unit tests cover the interval).
    expect(await instance(w.a.instances.priv)).toMatchObject({ status: 'missing' });
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
          kind: 'completion',
          effectiveOn: '2030-01-01',
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const bBefore = await w.admin.query(
      `SELECT id, status, row_version FROM public.requirement_instance WHERE organization_id = $1 ORDER BY id`,
      [w.b.id],
    );
    const bChain = (await audit(w.b)).length;
    await recomputeTenant(w.tenant, w.a.id, { asOf: parseInstant('2031-07-01T04:30:00Z') });
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
        effectiveOn: '2030-02-01',
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
      catalog_version: latest,
      as_of_date: '2030-09-29',
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
    expect(after.map((s) => s.catalog_version)).toEqual([latest, v2]);
    expect(after[0]).toEqual(first[0]);
    expect(await instance(w.a.instances.procedures)).toMatchObject({ status: 'not_assessed' });
    expect(await instance(w.a.instances.budget)).toMatchObject({ status: 'missing' });
    // A snapshot is never edited, whoever tries.
    await expectPgError(
      w.admin.query(`UPDATE public.readiness_snapshot SET met = 0 WHERE id = $1`, [first[0].id]),
      '42501',
    );
  });
});
