/**
 * @deemed/worker: job handlers by queue (ADR-0001, ADR-0010 section 3). Hosts (the local
 * long-running worker, the Netlify scheduled tick, and the integration tests) call
 * `drain({ platform, handlers: workerHandlers(...) })` from @deemed/jobs.
 *
 * S4 registers the readiness recompute. The scheduled tick, the nightly sweep window,
 * and the other queues (screening, expirations, notifications) arrive with S5.
 */
import { assertCatalogChannel, type Database } from '@deemed/db';
import type { JobHandler } from '@deemed/jobs';
import { RECOMPUTE_QUEUE, recomputeHandler } from '@deemed/readiness/service';

export const packageName = '@deemed/worker';

export interface WorkerServices {
  /** app_user connection: handlers open their own withTenant transaction. */
  tenant: Database;
}

/**
 * Worker startup: refuses to run when DH_ENV and the database's catalog channel disagree
 * (S4), then returns the handlers.
 */
export async function startWorker(
  services: WorkerServices & { dhEnv: string },
): Promise<Record<string, JobHandler>> {
  await assertCatalogChannel(services.tenant, services.dhEnv);
  return workerHandlers(services);
}

export function workerHandlers(services: WorkerServices): Record<string, JobHandler> {
  return {
    [RECOMPUTE_QUEUE]: recomputeHandler(services.tenant),
  };
}
