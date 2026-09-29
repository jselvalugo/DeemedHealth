/**
 * @deemed/jobs: the queue interface (ADR-0001) and its Postgres adapter.
 *
 *  - `sendJob(tx, ...)` enqueues inside the caller's withTenant transaction through
 *    public.enqueue_job, so a job exists only if the change that caused it commits
 *    (ADR-0010 section 3). `sendPlatformJob` is the app_platform fan-out variant.
 *  - `drain({ budgetMs })` claims ready jobs as app_platform (platform.claim_jobs), runs
 *    each handler, and marks it complete, or failed with a retry. It stops when the queue
 *    is empty or the budget is spent; unfinished work waits for the next drain. Handlers
 *    open their own withTenant transaction from the job's tenant (ADR-0001).
 *  - A claimed job holds a lease; if the process dies, the lease expires and the next
 *    drain resumes it. Every job row is its own run record (state, attempts, times,
 *    last error code). Error messages are never stored or logged, only stable codes.
 *
 * Interim adapter: ADR-0001 names pg-boss. This adapter keeps the same interface on
 * reviewed SQL functions (migration 0010) that fit the role model (app_user enqueues,
 * app_platform drains, no runtime DDL); swapping in a pg-boss adapter is S5's decision.
 */
import { type Actor, type Database, type Tx } from '@deemed/db';
import { sql } from 'drizzle-orm';

/** Queue names: dotted snake_case, e.g. `readiness.recompute`. */
export const QUEUE_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface SendOptions {
  /** Ids and dates only, never personal data (ADR-0001): registered keys, scalar values. */
  payload?: Record<string, string | number | boolean | null>;
  /** A queued job with the same queue, tenant, and key absorbs this one. */
  singletonKey?: string;
  /**
   * Label for the audit events the job writes. Platform jobs only: a tenant-enqueued job
   * always carries its kind's label from platform.job_kind (S5).
   */
  actorLabel?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

function assertQueue(queue: string): void {
  if (!QUEUE_NAME.test(queue)) throw new Error('invalid queue name');
}

/**
 * Enqueues in the current tenant transaction (withTenant). Returns the job id. The kind
 * must be registered in platform.job_kind as tenant-enqueueable; its registry row fixes
 * the actor label, the attempt limit, the allowed payload keys, and the queued cap (S5).
 */
export async function sendJob(tx: Tx, queue: string, options: SendOptions = {}): Promise<string> {
  assertQueue(queue);
  const r = await tx.execute<{ id: string }>(sql`
    SELECT public.enqueue_job(
      p_queue         => ${queue}::text,
      p_payload       => ${JSON.stringify(options.payload ?? {})}::jsonb,
      p_singleton_key => ${options.singletonKey ?? null}::text,
      p_run_after     => ${options.runAfter?.toISOString() ?? null}::timestamptz,
      p_max_attempts  => ${options.maxAttempts ?? null}::integer
    )::text AS id`);
  const id = r.rows[0]?.id;
  if (!id) throw new Error('enqueue_job returned no id');
  return id;
}

/** Enqueues from an app_platform transaction (withPlatform), for one tenant or none. */
export async function sendPlatformJob(
  tx: Tx,
  organizationId: string | null,
  queue: string,
  options: SendOptions = {},
): Promise<string> {
  assertQueue(queue);
  const r = await tx.execute<{ id: string }>(sql`
    SELECT platform.enqueue_job(
      p_organization_id => ${organizationId}::uuid,
      p_queue           => ${queue}::text,
      p_payload         => ${JSON.stringify(options.payload ?? {})}::jsonb,
      p_singleton_key   => ${options.singletonKey ?? null}::text,
      p_actor_label     => ${options.actorLabel ?? null}::text,
      p_run_after       => ${options.runAfter?.toISOString() ?? null}::timestamptz,
      p_max_attempts    => ${options.maxAttempts ?? null}::integer
    )::text AS id`);
  const id = r.rows[0]?.id;
  if (!id) throw new Error('platform.enqueue_job returned no id');
  return id;
}

export interface ClaimedJob {
  id: string;
  queue: string;
  organizationId: string | null;
  actorLabel: string;
  requestId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** A failure with a stable code (stored on the job row) and optional retry delay. */
export class JobError extends Error {
  override name = 'JobError';
  constructor(
    readonly code: string,
    readonly options: { retryAfterSeconds?: number } = {},
  ) {
    super(code);
  }
}

export type JobHandler = (job: ClaimedJob) => Promise<void>;

export interface DrainOptions {
  /** Connection logged in as (or assuming) app_platform. */
  platform: Database;
  /** Handlers by queue; only these queues are claimed. */
  handlers: Readonly<Record<string, JobHandler>>;
  /** Stop claiming new batches after this many milliseconds (default 20 000). */
  budgetMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  /** Retry delay after a failed attempt (default 30 s x attempt, at most 1 h). */
  retryAfterSeconds?: (attempt: number) => number;
  /** Monotonic milliseconds, for the budget (default performance.now). */
  now?: () => number;
}

export type RunOutcome = 'completed' | 'queued' | 'failed' | 'superseded';

export interface DrainResult {
  stoppedBy: 'empty' | 'budget';
  runs: { id: string; queue: string; outcome: RunOutcome; errorCode?: string }[];
}

const DRAIN_ACTOR: Actor = { type: 'system', label: 'job drain' };
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,100}$/;

function errorCode(error: unknown): string {
  if (error instanceof JobError && ERROR_CODE.test(error.code)) return error.code;
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const pgCode = typeof e?.code === 'string' ? e.code : e?.cause?.code;
  if (typeof pgCode === 'string' && /^[0-9A-Z]{5}$/.test(pgCode)) return `pg_${pgCode}`;
  return 'handler_error';
}

type JobRow = {
  id: string;
  queue: string;
  organization_id: string | null;
  actor_label: string;
  request_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export async function drain(options: DrainOptions): Promise<DrainResult> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const budget = options.budgetMs ?? 20_000;
  const queues = Object.keys(options.handlers).sort();
  for (const q of queues) assertQueue(q);
  const retry =
    options.retryAfterSeconds ?? ((attempt: number) => Math.min(3600, 30 * Math.max(1, attempt)));
  const runs: DrainResult['runs'] = [];
  const queueArray = `{${queues.join(',')}}`;

  while (now() - started < budget) {
    const claimed = await options.platform.withPlatform(DRAIN_ACTOR, async (tx) => {
      const r = await tx.execute<JobRow>(sql`
        SELECT id::text, queue, organization_id::text, actor_label, request_id::text, payload,
               attempts, max_attempts
        FROM platform.claim_jobs(${queueArray}::text[], ${options.batchSize ?? 10}::integer,
                                 ${options.leaseSeconds ?? 300}::integer)`);
      return r.rows;
    });
    if (claimed.length === 0) return { stoppedBy: 'empty', runs };

    for (const row of claimed) {
      const job: ClaimedJob = {
        id: row.id,
        queue: row.queue,
        organizationId: row.organization_id,
        actorLabel: row.actor_label,
        requestId: row.request_id,
        payload: row.payload,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      };
      const handler = options.handlers[job.queue] as JobHandler;
      try {
        await handler(job);
        await options.platform.withPlatform(DRAIN_ACTOR, (tx) =>
          tx.execute(sql`SELECT platform.complete_job(${job.id}::uuid)`),
        );
        runs.push({ id: job.id, queue: job.queue, outcome: 'completed' });
      } catch (error) {
        const code = errorCode(error);
        const delay =
          error instanceof JobError && error.options.retryAfterSeconds !== undefined
            ? error.options.retryAfterSeconds
            : retry(job.attempts);
        const outcome = await options.platform.withPlatform(DRAIN_ACTOR, async (tx) => {
          const r = await tx.execute<{ outcome: RunOutcome | null }>(
            sql`SELECT platform.fail_job(${job.id}::uuid, ${code}::text, ${delay}::integer) AS outcome`,
          );
          return r.rows[0]?.outcome ?? 'failed';
        });
        runs.push({ id: job.id, queue: job.queue, outcome: outcome, errorCode: code });
      }
    }
  }
  return { stoppedBy: 'budget', runs };
}
