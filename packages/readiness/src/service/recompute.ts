/**
 * The readiness recompute job (G1-8). A data change (N/A mark, tenant parameter, evidence
 * fact) enqueues `readiness.recompute` in its own transaction (`enqueueRecompute`); a
 * catalog release and the nightly sweep enqueue it for every tenant. The job loads the
 * tenant's instances, facts, and parameters with the active catalog release, runs the pure
 * engine for each instance in the instance's site time zone, stores what changed (with an
 * audit event per change), and, for the nightly sweep, stores one snapshot per day pinned
 * to the catalog release. Re-running it changes nothing (idempotent).
 */
import {
  instantFromEpochMilliseconds,
  parseCalendarDate,
  parseTimeZone,
  toZonedDate,
  type Clock,
  type Instant,
  type TimeZone,
} from '@deemed/dates';
import {
  appendAuditEvent,
  listTenants,
  redactedDiff,
  type Actor,
  type Database,
  type TransactionContext,
  type Tx,
} from '@deemed/db';
import {
  JobError,
  sendJob,
  sendPlatformJob,
  spreadDelaySeconds,
  type ClaimedJob,
  type JobHandler,
} from '@deemed/jobs';
import type { JsonValue } from '@deemed/domain';
import { canonicalJson } from '@deemed/requirements-catalog/compiler';
import { sql } from 'drizzle-orm';
import { evaluate } from '../evaluate.js';
import { reason } from '../messages.js';
import { buildSnapshot, type SnapshotItem } from '../snapshot.js';
import {
  ENGINE_VERSION,
  READINESS_STATUSES,
  type ApplicabilityContext,
  type ApprovalCapacity,
  type FactKind,
  type ReadinessFact,
  type ReadinessStatus,
  type Reason,
} from '../types.js';
import { RECOMPUTE_QUEUE, loadActiveCatalog } from './catalog.js';

export { RECOMPUTE_QUEUE };

/** Enqueue a recompute of the current tenant in the caller's transaction. */
export async function enqueueRecompute(tx: Tx, cause: string): Promise<string> {
  return sendJob(tx, RECOMPUTE_QUEUE, { singletonKey: RECOMPUTE_QUEUE, payload: { cause } });
}

/** The nightly sweep spreads tenants over 15 minutes (S6). */
export const NIGHTLY_SPREAD_SECONDS = 900;

/**
 * Nightly sweep (inside withPlatform as app_platform): one recompute per active tenant
 * that also stores the day's snapshot. The singleton key names the tenant's local date,
 * and the snapshot is unique per tenant, release, date, and kind, so running the sweep
 * twice stores nothing twice.
 */
export async function enqueueNightlySweep(
  tx: Tx,
  asOf: Instant,
  options: { spreadSeconds?: number } = {},
): Promise<number> {
  const spread = options.spreadSeconds ?? NIGHTLY_SPREAD_SECONDS;
  let n = 0;
  for (const t of await listTenants(tx)) {
    if (t.status !== 'active') continue;
    const day = toZonedDate(asOf, parseTimeZone(t.timeZone));
    await sendPlatformJob(tx, t.organizationId, RECOMPUTE_QUEUE, {
      singletonKey: `readiness.nightly.${day}`,
      actorLabel: 'readiness nightly sweep',
      payload: { snapshot: 'nightly', asOfDate: day },
      delaySeconds: spreadDelaySeconds(t.organizationId, spread),
    });
    n += 1;
  }
  return n;
}

export interface RecomputeOptions {
  /**
   * The evaluation instant. Omitted (the live job): the database clock of the recompute
   * transaction, the same clock that stamps recorded_at and not_applicable_at, so a mark or
   * fact that just committed is never "in the future" because of worker clock skew.
   */
  asOf?: Instant;
  snapshot?: 'nightly' | 'on_demand' | null;
  actorLabel?: string;
}

export interface RecomputeSummary {
  organizationId: string;
  catalogVersion: string | null;
  evaluated: number;
  changed: number;
  snapshotId: string | null;
  statuses: Record<ReadinessStatus, number>;
}

type InstanceRow = {
  id: string;
  requirement_id: string;
  subject_type: 'organization' | 'site' | 'person';
  site_id: string | null;
  status: ReadinessStatus;
  next_due_on: string | null;
  status_reasons: unknown;
  catalog_release_id: string | null;
  requirement_version_id: string | null;
  not_applicable_reason: string | null;
  na_recorded_ms: string | null;
  na_superseded_version: string | null;
};

type FactRow = {
  id: string;
  requirement_instance_id: string;
  kind: FactKind;
  evidence_type_id: string | null;
  effective_on: string;
  expires_on: string | null;
  approval_capacity: ApprovalCapacity | null;
  approval_decision: 'approved' | 'rejected' | null;
  approval_type_id: string | null;
  recorded_ms: string;
  retracted_ms: string | null;
};

const ms = (v: string | null): Instant | null =>
  v === null ? null : instantFromEpochMilliseconds(Number(v));

type Stored = {
  status: ReadinessStatus;
  next_due_on: string | null;
  status_reasons: {
    code: string;
    params: Readonly<Record<string, string | number | null>>;
    paramKeys: Readonly<Record<string, string>>;
  }[];
  catalog_release_id: string | null;
  requirement_version_id: string | null;
  not_applicable_superseded_catalog_version: string | null;
};

const asRow = (s: Stored): Record<string, JsonValue> => s as unknown as Record<string, JsonValue>;

function storedReasons(reasons: readonly Reason[]): Stored['status_reasons'] {
  return reasons.map((r) => ({ code: r.code, params: r.params, paramKeys: r.paramKeys }));
}

/** Evaluates every active instance of one tenant and stores the changes. */
export async function recomputeTenant(
  db: Database,
  organizationId: string,
  options: RecomputeOptions,
): Promise<RecomputeSummary> {
  const actor: Actor = { type: 'system', label: options.actorLabel ?? 'readiness recompute' };
  return db.withTenant(organizationId, actor, (tx, ctx) =>
    recomputeInTransaction(tx, ctx, organizationId, options),
  );
}

async function recomputeInTransaction(
  tx: Tx,
  ctx: TransactionContext,
  organizationId: string,
  options: RecomputeOptions,
): Promise<RecomputeSummary> {
  // One recompute per tenant at a time; a second waits and then sees the first's result.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('readiness:' || ${organizationId}))`);
  const asOf =
    options.asOf ??
    instantFromEpochMilliseconds(
      Number(
        (
          await tx.execute<{ ms: string }>(
            sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS ms`,
          )
        ).rows[0]?.ms,
      ),
    );
  const org = (
    await tx.execute<{
      award_type: 'section330' | 'lookalike';
      sub_programs: string[];
      time_zone: string;
    }>(
      sql`SELECT award_type, sub_programs, time_zone FROM public.organization WHERE id = ${organizationId}::uuid`,
    )
  ).rows[0];
  if (!org) throw new JobError('organization_not_found');
  const orgZone = parseTimeZone(org.time_zone);
  const sites = new Map(
    (
      await tx.execute<{ id: string; site_type: string; time_zone: string }>(
        sql`SELECT id::text, site_type, time_zone FROM public.site`,
      )
    ).rows.map((s) => [s.id, { siteType: s.site_type, zone: parseTimeZone(s.time_zone) }]),
  );
  const catalog = await loadActiveCatalog(tx);
  const instances = (
    await tx.execute<InstanceRow>(sql`
      SELECT id::text, requirement_id, subject_type, site_id::text, status,
             next_due_on::text, status_reasons, catalog_release_id::text,
             requirement_version_id::text, not_applicable_reason,
             not_applicable_superseded_catalog_version AS na_superseded_version,
             floor(extract(epoch FROM not_applicable_at) * 1000)::bigint::text AS na_recorded_ms
      FROM public.requirement_instance WHERE archived_at IS NULL ORDER BY id`)
  ).rows;
  const facts = new Map<string, ReadinessFact[]>();
  for (const f of (
    await tx.execute<FactRow>(sql`
      SELECT id::text, requirement_instance_id::text, kind, evidence_type_id, effective_on::text,
             expires_on::text,
             approval_capacity, approval_decision, approval_type_id,
             floor(extract(epoch FROM recorded_at) * 1000)::bigint::text AS recorded_ms,
             floor(extract(epoch FROM retracted_at) * 1000)::bigint::text AS retracted_ms
      FROM public.readiness_fact ORDER BY id`)
  ).rows) {
    const list = facts.get(f.requirement_instance_id) ?? [];
    list.push({
      id: f.id,
      kind: f.kind,
      evidenceTypeId: f.evidence_type_id,
      effectiveOn: parseCalendarDate(f.effective_on),
      expiresOn: f.expires_on === null ? null : parseCalendarDate(f.expires_on),
      recordedAt: ms(f.recorded_ms) as Instant,
      retractedAt: ms(f.retracted_ms),
      approval:
        f.kind === 'approval' && f.approval_capacity && f.approval_decision
          ? {
              capacity: f.approval_capacity,
              decision: f.approval_decision,
              approvalTypeId: f.approval_type_id,
            }
          : null,
    });
    facts.set(f.requirement_instance_id, list);
  }
  const params = new Map<string, Record<string, number>>();
  for (const p of (
    await tx.execute<{ requirement_id: string; parameter_key: string; value: number }>(
      sql`SELECT requirement_id, parameter_key, value FROM public.tenant_parameter`,
    )
  ).rows) {
    params.set(p.requirement_id, {
      ...(params.get(p.requirement_id) ?? {}),
      [p.parameter_key]: p.value,
    });
  }

  const release = catalog.release;
  const firstUnderRelease =
    release !== null &&
    instances.length > 0 &&
    !instances.some((i) => i.catalog_release_id === release.id);
  const statuses = Object.fromEntries(READINESS_STATUSES.map((s) => [s, 0])) as Record<
    ReadinessStatus,
    number
  >;
  const items: SnapshotItem[] = [];
  let changed = 0;

  for (const inst of instances) {
    const site = inst.site_id ? sites.get(inst.site_id) : undefined;
    const zone: TimeZone = site?.zone ?? orgZone;
    const hit = catalog.entries.get(inst.requirement_id);
    let status: ReadinessStatus;
    let nextDueOn: string | null = null;
    let reasons: Reason[];
    let versionId: string | null = null;
    let chapter: number | null = null;
    let authority: SnapshotItem['authority'] = 'hrsa';
    // A person's N/A mark is never changed here: only its "superseded" flag moves, and
    // only on an actual evaluation (never for a not-assessed cause).
    let superseded = inst.na_superseded_version;

    if (!release) {
      status = 'not_assessed';
      reasons = [reason('no_catalog_release')];
    } else if (!hit) {
      status = 'not_assessed';
      reasons = [reason('not_in_catalog', { catalogVersion: release.catalogVersion })];
    } else {
      const applicability: ApplicabilityContext = {
        awardType: org.award_type,
        subPrograms: org.sub_programs,
        siteType: site?.siteType ?? null,
        staffTypes: null,
        // Staff types live in provider profiles (a later slice); until then the instance's
        // existence is the applicability decision for that dimension.
        ...(inst.subject_type === 'person' ? { unknownDimensions: ['staffTypes'] as const } : {}),
      };
      const naAt = ms(inst.na_recorded_ms);
      const na =
        inst.not_applicable_reason !== null && naAt !== null
          ? {
              // The decision date in the instance's own calendar.
              decidedOn: toZonedDate(naAt, zone),
              recordedAt: naAt,
              hasReason: inst.not_applicable_reason.trim().length > 0,
            }
          : null;
      const result = evaluate({
        entry: hit.entry,
        catalogVersion: release.catalogVersion,
        channel: release.channel,
        applicability,
        tenantParameters: params.get(inst.requirement_id) ?? {},
        facts: facts.get(inst.id) ?? [],
        notApplicable: na,
        asOf,
        timeZone: zone,
      });
      status = result.status;
      nextDueOn = result.nextDueOn;
      reasons = [...result.reasons];
      versionId = hit.versionId;
      chapter = result.citation.chapter;
      authority = result.citation.authority;
      if (result.notApplicableSuperseded) superseded = superseded ?? release.catalogVersion;
      else if (result.status === 'not_applicable') superseded = null;
    }
    statuses[status] += 1;
    items.push({
      instanceId: inst.id,
      requirementId: inst.requirement_id,
      siteId: inst.site_id,
      chapter,
      authority,
      status,
      nextDueOn: nextDueOn as SnapshotItem['nextDueOn'],
      reasonCodes: reasons.map((r) => r.code),
    });

    const next: Stored = {
      status,
      next_due_on: nextDueOn,
      status_reasons: storedReasons(reasons),
      catalog_release_id: release?.id ?? null,
      requirement_version_id: versionId,
      not_applicable_superseded_catalog_version: superseded,
    };
    const prev: Stored = {
      status: inst.status,
      next_due_on: inst.next_due_on,
      status_reasons: inst.status_reasons as Stored['status_reasons'],
      catalog_release_id: inst.catalog_release_id,
      requirement_version_id: inst.requirement_version_id,
      not_applicable_superseded_catalog_version: inst.na_superseded_version,
    };
    if (canonicalJson(next) === canonicalJson(prev)) continue;
    changed += 1;
    await tx.execute(sql`
      UPDATE public.requirement_instance
      SET status = ${next.status}, next_due_on = ${next.next_due_on}::date,
          status_reasons = ${JSON.stringify(next.status_reasons)}::jsonb,
          catalog_release_id = ${next.catalog_release_id}::uuid,
          requirement_version_id = ${next.requirement_version_id}::uuid,
          not_applicable_superseded_catalog_version = ${superseded}::text,
          not_applicable_superseded_at = CASE
            WHEN ${superseded}::text IS NULL THEN NULL
            ELSE coalesce(not_applicable_superseded_at, now()) END,
          status_computed_at = now()
      WHERE id = ${inst.id}::uuid`);
    const common = {
      targetTable: 'requirement_instance',
      targetId: inst.id,
      requirementIds: [inst.requirement_id],
      ...(inst.site_id ? { siteId: inst.site_id } : {}),
    };
    await appendAuditEvent(tx, ctx, {
      ...common,
      category: 'mutation',
      action: 'requirement_instance.evaluate',
      diff: redactedDiff('public.requirement_instance', asRow(prev), asRow(next)),
      metadata: {
        catalogVersion: release?.catalogVersion ?? null,
        engineVersion: ENGINE_VERSION,
        label: 'internal_readiness_not_hrsa_determination',
      },
    });
  }

  if (firstUnderRelease && release) {
    await appendAuditEvent(tx, ctx, {
      category: 'system',
      action: 'catalog_release.applied',
      reason: `catalog ${release.catalogVersion} (${release.channel}) applied to readiness`,
      metadata: { catalogVersion: release.catalogVersion, channel: release.channel },
    });
  }

  let snapshotId: string | null = null;
  if (options.snapshot && release) {
    const asOfDate = toZonedDate(asOf, orgZone);
    const body = buildSnapshot({
      catalogVersion: release.catalogVersion,
      channel: release.channel,
      asOfDate,
      items,
    });
    const r = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.readiness_snapshot
        (organization_id, catalog_release_id, catalog_version, engine_version, as_of_date, kind,
         met, denominator, body)
      VALUES (${organizationId}::uuid, ${release.id}::uuid, ${release.catalogVersion}, ${ENGINE_VERSION},
              ${asOfDate}::date, ${options.snapshot}, ${body.total.met}, ${body.total.denominator},
              ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (organization_id, catalog_release_id, as_of_date, kind) DO NOTHING
      RETURNING id::text`);
    snapshotId = r.rows[0]?.id ?? null;
    if (snapshotId) {
      await appendAuditEvent(tx, ctx, {
        category: 'system',
        action: 'readiness_snapshot.create',
        targetTable: 'readiness_snapshot',
        targetId: snapshotId,
        reason: `${options.snapshot} readiness snapshot for ${asOfDate} (internal readiness, not an HRSA determination)`,
        metadata: {
          catalogVersion: release.catalogVersion,
          met: body.total.met,
          denominator: body.total.denominator,
        },
      });
    }
  }

  return {
    organizationId,
    catalogVersion: release?.catalogVersion ?? null,
    evaluated: instances.length,
    changed,
    snapshotId,
    statuses,
  };
}

/**
 * The `readiness.recompute` handler: runs as app_user under the job's tenant. The live
 * worker passes no clock (the database clock is the as-of instant); tests and as-of runs
 * pass a fixed one.
 */
export function recomputeHandler(tenantDb: Database, clock?: Clock): JobHandler {
  return async (job: ClaimedJob) => {
    if (!job.organizationId) throw new JobError('no_tenant');
    const snapshot = job.payload.snapshot;
    await recomputeTenant(tenantDb, job.organizationId, {
      ...(clock ? { asOf: clock.now() } : {}),
      snapshot: snapshot === 'nightly' || snapshot === 'on_demand' ? snapshot : null,
      actorLabel: job.actorLabel,
    });
  };
}
