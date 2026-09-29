/**
 * Readiness mutations that people (and integrations) make. Each runs inside the caller's
 * withTenant transaction, checks the catalog, writes one audit event, and enqueues a
 * recompute in the same transaction (so the job exists only if the change commits).
 *
 *  - Not applicable: only where the catalog allows it, with a reason, by a human user
 *    (product principle 2: AI never attests). Enforced here and by the database.
 *  - Tenant parameters: only parameters the entry declares, within its bounds, with a
 *    reason, by a human user.
 *  - Evidence facts: by a person or an integration, never a service (AI) actor. Corrected
 *    only by a human retraction with a reason.
 */
import {
  appendAuditEvent,
  redactedDiff,
  type TextDigest,
  type TransactionContext,
  type Tx,
} from '@deemed/db';
import type { JsonValue } from '@deemed/domain';
import {
  KnownParameters,
  checkTenantParameterValue,
  type CatalogEntry,
} from '@deemed/requirements-catalog';
import { sql } from 'drizzle-orm';
import type { FactKind } from '../types.js';
import { loadActiveCatalog } from './catalog.js';
import { ReadinessError } from './errors.js';
import { enqueueRecompute } from './recompute.js';

const MAX_REASON = 2000;
const HUMAN = new Set(['user', 'break_glass']);

function requireHuman(ctx: TransactionContext): void {
  if (!HUMAN.has(ctx.actor.type)) throw new ReadinessError('human_actor_required');
}

function cleanReason(reason: unknown, field = 'reason'): string {
  if (typeof reason !== 'string') throw new ReadinessError('invalid_reason', [field]);
  const t = reason.trim();
  if (t.length === 0 || t.length > MAX_REASON) throw new ReadinessError('invalid_reason', [field]);
  return t;
}

async function catalogEntry(tx: Tx, requirementId: string): Promise<CatalogEntry> {
  const catalog = await loadActiveCatalog(tx);
  if (!catalog.release) throw new ReadinessError('no_catalog_release');
  const hit = catalog.entries.get(requirementId);
  if (!hit) throw new ReadinessError('not_in_catalog', ['requirementId']);
  return hit.entry;
}

export interface InstanceRef {
  id: string;
  requirementId: string;
  siteId: string | null;
  subjectType: string;
  subjectId: string;
  ownerPersonId: string | null;
  status: string;
  rowVersion: number;
  notApplicableReason: string | null;
}

/** Reads one active instance of the current tenant (RLS hides other tenants: not_found). */
export async function loadInstance(tx: Tx, id: string): Promise<InstanceRef> {
  const r = await tx.execute<{
    id: string;
    requirement_id: string;
    site_id: string | null;
    subject_type: string;
    subject_id: string;
    owner_person_id: string | null;
    status: string;
    row_version: number;
    not_applicable_reason: string | null;
  }>(sql`
    SELECT id::text, requirement_id, site_id::text, subject_type, subject_id::text,
           owner_person_id::text, status, row_version, not_applicable_reason
    FROM public.requirement_instance WHERE id = ${id}::uuid AND archived_at IS NULL
    FOR UPDATE`);
  const row = r.rows[0];
  if (!row) throw new ReadinessError('not_found');
  return {
    id: row.id,
    requirementId: row.requirement_id,
    siteId: row.site_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    ownerPersonId: row.owner_person_id,
    status: row.status,
    rowVersion: row.row_version,
    notApplicableReason: row.not_applicable_reason,
  };
}

function checkVersion(instance: InstanceRef, expected: number | undefined): void {
  if (expected !== undefined && expected !== instance.rowVersion) {
    throw new ReadinessError('version_conflict', [], instance.rowVersion);
  }
}

export interface MarkNotApplicableInput {
  instanceId: string;
  reason: string;
  expectedRowVersion?: number;
  digest?: TextDigest;
}

export async function markNotApplicable(
  tx: Tx,
  ctx: TransactionContext,
  input: MarkNotApplicableInput,
): Promise<{ instance: InstanceRef; rowVersion: number; jobId: string }> {
  requireHuman(ctx);
  const reason = cleanReason(input.reason);
  const instance = await loadInstance(tx, input.instanceId);
  checkVersion(instance, input.expectedRowVersion);
  if (instance.notApplicableReason !== null) throw new ReadinessError('already_not_applicable');
  const entry = await catalogEntry(tx, instance.requirementId);
  if (!entry.notApplicable.allowed) throw new ReadinessError('not_applicable_not_allowed');
  const r = await tx.execute<{ row_version: number }>(sql`
    UPDATE public.requirement_instance
    SET status = 'not_applicable', not_applicable_reason = ${reason}, status_computed_at = now()
    WHERE id = ${instance.id}::uuid RETURNING row_version`);
  await appendAuditEvent(tx, ctx, {
    category: 'mutation',
    action: 'requirement_instance.mark_not_applicable',
    targetTable: 'requirement_instance',
    targetId: instance.id,
    requirementIds: [instance.requirementId],
    ...(instance.siteId ? { siteId: instance.siteId } : {}),
    diff: redactedDiff(
      'public.requirement_instance',
      { status: instance.status, not_applicable_reason: null },
      { status: 'not_applicable', not_applicable_reason: reason },
      input.digest,
    ),
  });
  const jobId = await enqueueRecompute(tx, 'not_applicable');
  return { instance, rowVersion: r.rows[0]?.row_version ?? instance.rowVersion + 1, jobId };
}

export async function clearNotApplicable(
  tx: Tx,
  ctx: TransactionContext,
  input: MarkNotApplicableInput,
): Promise<{ instance: InstanceRef; rowVersion: number; jobId: string }> {
  requireHuman(ctx);
  const reason = cleanReason(input.reason);
  const instance = await loadInstance(tx, input.instanceId);
  checkVersion(instance, input.expectedRowVersion);
  if (instance.notApplicableReason === null) throw new ReadinessError('not_marked_not_applicable');
  // The engine sets the real status on the recompute enqueued below.
  const r = await tx.execute<{ row_version: number }>(sql`
    UPDATE public.requirement_instance
    SET status = 'not_assessed', not_applicable_reason = NULL, status_computed_at = now()
    WHERE id = ${instance.id}::uuid RETURNING row_version`);
  await appendAuditEvent(tx, ctx, {
    category: 'mutation',
    action: 'requirement_instance.clear_not_applicable',
    targetTable: 'requirement_instance',
    targetId: instance.id,
    requirementIds: [instance.requirementId],
    ...(instance.siteId ? { siteId: instance.siteId } : {}),
    diff: redactedDiff(
      'public.requirement_instance',
      { status: instance.status, not_applicable_reason: instance.notApplicableReason },
      { status: 'not_assessed', not_applicable_reason: null },
      input.digest,
    ),
  });
  const jobId = await enqueueRecompute(tx, 'clear_not_applicable');
  return { instance, rowVersion: r.rows[0]?.row_version ?? instance.rowVersion + 1, jobId };
}

export interface SetTenantParameterInput {
  requirementId: string;
  key: string;
  value: number;
  reason: string;
  expectedRowVersion?: number;
  digest?: TextDigest;
}

export async function setTenantParameter(
  tx: Tx,
  ctx: TransactionContext,
  input: SetTenantParameterInput,
): Promise<{ id: string; value: number; rowVersion: number; jobId: string | null }> {
  requireHuman(ctx);
  const reason = cleanReason(input.reason);
  const entry = await catalogEntry(tx, input.requirementId);
  const known = KnownParameters.safeParse(entry.parameters);
  const spec = known.success ? known.data.tenantParameters?.[input.key] : undefined;
  if (!spec) throw new ReadinessError('parameter_unknown', ['key']);
  if (checkTenantParameterValue(spec, input.value) !== null) {
    throw new ReadinessError('parameter_out_of_bounds', ['value']);
  }
  const existing = (
    await tx.execute<{ id: string; value: number; reason: string; row_version: number }>(sql`
      SELECT id::text, value, reason, row_version FROM public.tenant_parameter
      WHERE requirement_id = ${input.requirementId} AND parameter_key = ${input.key} FOR UPDATE`)
  ).rows[0];
  if (
    existing &&
    input.expectedRowVersion !== undefined &&
    existing.row_version !== input.expectedRowVersion
  ) {
    throw new ReadinessError('version_conflict', [], existing.row_version);
  }
  const before: Record<string, JsonValue> | null = existing
    ? { value: existing.value, reason: existing.reason }
    : null;
  let row: { id: string; row_version: number };
  if (existing) {
    if (existing.value === input.value && existing.reason === reason) {
      return {
        id: existing.id,
        value: existing.value,
        rowVersion: existing.row_version,
        jobId: null,
      };
    }
    row = (
      await tx.execute<{ id: string; row_version: number }>(sql`
        UPDATE public.tenant_parameter SET value = ${input.value}, reason = ${reason}
        WHERE id = ${existing.id}::uuid RETURNING id::text, row_version`)
    ).rows[0] as { id: string; row_version: number };
  } else {
    row = (
      await tx.execute<{ id: string; row_version: number }>(sql`
        INSERT INTO public.tenant_parameter (organization_id, requirement_id, parameter_key, value, reason)
        VALUES (${ctx.organizationId}::uuid, ${input.requirementId}, ${input.key}, ${input.value}, ${reason})
        RETURNING id::text, row_version`)
    ).rows[0] as { id: string; row_version: number };
  }
  await appendAuditEvent(tx, ctx, {
    category: 'mutation',
    action: 'tenant_parameter.set',
    targetTable: 'tenant_parameter',
    targetId: row.id,
    requirementIds: [input.requirementId],
    diff: redactedDiff(
      'public.tenant_parameter',
      before === null ? null : { parameter_key: input.key, ...before },
      { parameter_key: input.key, value: input.value, reason },
      input.digest,
    ),
    metadata: { parameterKey: input.key, min: spec.min, max: spec.max },
  });
  const jobId = await enqueueRecompute(tx, 'tenant_parameter');
  return { id: row.id, value: input.value, rowVersion: row.row_version, jobId };
}

export interface RecordFactInput {
  instanceId: string;
  /** document, completion, expiration, or change. Approval facts arrive with S5. */
  kind: FactKind;
  effectiveOn: string;
  expiresOn?: string | null;
  /** S6: the evidence file version behind the fact (no FK until evidence tables exist). */
  evidenceVersionId?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Records one evidence fact: a person or an integration, never a service (AI) or system
 * actor. Approval facts are refused until S5 (F3, S2): public.approval records no
 * capacity or approval type, and a fact never takes them from input. Integrations may
 * not record approvals at all, nor documents until evidence versions exist (S6).
 */
export async function recordFact(
  tx: Tx,
  ctx: TransactionContext,
  input: RecordFactInput,
): Promise<{ id: string; jobId: string }> {
  const type = ctx.actor.type;
  if (type !== 'user' && type !== 'break_glass' && type !== 'integration') {
    throw new ReadinessError('actor_not_allowed');
  }
  if (input.kind === 'approval') {
    if (type === 'integration') throw new ReadinessError('actor_not_allowed');
    throw new ReadinessError('approval_facts_unavailable');
  }
  if (input.kind === 'document' && type === 'integration') {
    // TODO(S6): accept integration documents that reference an evidence_version.
    throw new ReadinessError('actor_not_allowed');
  }
  if (!ISO_DATE.test(input.effectiveOn) || (input.expiresOn && !ISO_DATE.test(input.expiresOn))) {
    throw new ReadinessError('invalid_fact', ['effectiveOn']);
  }
  if ((input.kind === 'expiration') !== Boolean(input.expiresOn)) {
    throw new ReadinessError('invalid_fact', ['expiresOn']);
  }
  const instance = await loadInstance(tx, input.instanceId);
  const r = await tx.execute<{ id: string }>(sql`
    INSERT INTO public.readiness_fact
      (organization_id, requirement_instance_id, kind, effective_on, expires_on,
       evidence_version_id, recorded_by_type)
    VALUES (${ctx.organizationId}::uuid, ${instance.id}::uuid, ${input.kind}, ${input.effectiveOn}::date,
            ${input.expiresOn ?? null}::date, ${input.evidenceVersionId ?? null}::uuid, ${type})
    RETURNING id::text`);
  const id = r.rows[0]?.id as string;
  await appendAuditEvent(tx, ctx, {
    category: 'mutation',
    action: 'readiness_fact.record',
    targetTable: 'readiness_fact',
    targetId: id,
    requirementIds: [instance.requirementId],
    ...(instance.siteId ? { siteId: instance.siteId } : {}),
    diff: redactedDiff('public.readiness_fact', null, {
      requirement_instance_id: instance.id,
      kind: input.kind,
      effective_on: input.effectiveOn,
      expires_on: input.expiresOn ?? null,
      recorded_by_type: type,
      approval_id: null,
      approval_type_id: null,
      approval_capacity: null,
      approval_decision: null,
      evidence_version_id: input.evidenceVersionId ?? null,
    }),
  });
  const jobId = await enqueueRecompute(tx, 'readiness_fact');
  return { id, jobId };
}

/** Retracts a fact (a human, with a reason); the engine ignores it from then on. */
export async function retractFact(
  tx: Tx,
  ctx: TransactionContext,
  input: { factId: string; reason: string; digest?: TextDigest },
): Promise<{ jobId: string }> {
  requireHuman(ctx);
  const reason = cleanReason(input.reason);
  const fact = (
    await tx.execute<{ id: string; requirement_instance_id: string; retracted: boolean }>(sql`
      SELECT id::text, requirement_instance_id::text, retracted_at IS NOT NULL AS retracted
      FROM public.readiness_fact WHERE id = ${input.factId}::uuid FOR UPDATE`)
  ).rows[0];
  if (!fact) throw new ReadinessError('not_found');
  if (fact.retracted) throw new ReadinessError('fact_retracted');
  const instance = await loadInstance(tx, fact.requirement_instance_id);
  await tx.execute(sql`
    UPDATE public.readiness_fact SET retract_reason = ${reason}, retracted_at = now()
    WHERE id = ${fact.id}::uuid`);
  await appendAuditEvent(tx, ctx, {
    category: 'mutation',
    action: 'readiness_fact.retract',
    targetTable: 'readiness_fact',
    targetId: fact.id,
    requirementIds: [instance.requirementId],
    ...(instance.siteId ? { siteId: instance.siteId } : {}),
    diff: redactedDiff(
      'public.readiness_fact',
      { retract_reason: null },
      { retract_reason: reason },
      input.digest,
    ),
  });
  return { jobId: await enqueueRecompute(tx, 'readiness_fact_retract') };
}
