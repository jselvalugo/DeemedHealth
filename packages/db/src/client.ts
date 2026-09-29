/**
 * Database access for apps/api and apps/worker (ADR-0001, ADR-0002, ADR-0011).
 *
 * Every tenant query runs inside withTenant(): one transaction on one pooled
 * connection, with the transaction-local settings (set_config(..., true)):
 *
 *   app.organization_id  the tenant; every RLS policy reads it without missing_ok
 *   app.actor_id         user_account id of a human actor ('' for service/system actors)
 *   app.actor_type       the actor's type (user, break_glass, service, integration, system)
 *   app.request_id       correlation id shared with logs and traces
 *   app.site_ids         '{uuid,...}' site scope, for PHI-table predicates (ADR-0002 section 5)
 *   app.roles            '{role,...}' role keys, for PHI-table predicates
 *
 * The settings vanish at COMMIT/ROLLBACK and can never leak to the next borrower of
 * the connection. Session-level SET is never used.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import type { ActorType } from './schema/audit.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** The transaction handle passed to withTenant / withPlatform callbacks. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Who is acting. Stamped on rows (created_by/updated_by) and audit events. */
export interface Actor {
  type: ActorType;
  /** Display label at the time of the action (shown in the audit log). */
  label: string;
  /** user_account.id; required for 'user' and 'break_glass', forbidden otherwise. */
  userId?: string;
  /** person.id of a human actor. */
  personId?: string;
  /** For 'service' actors (e.g. the AI assistant): the human they act for (ADR-0008 section 4). */
  onBehalfOfId?: string;
}

/** What a withTenant / withPlatform callback receives besides the transaction. */
export interface TransactionContext {
  /** null inside withPlatform. */
  organizationId: string | null;
  actor: Actor;
  requestId: string;
}

export interface TransactionOptions {
  /** Correlation id shared with logs and traces; generated when absent. */
  requestId?: string;
  /** Site scope of the session (app.site_ids). */
  siteIds?: readonly string[];
  /** Role keys of the session (app.roles). */
  roles?: readonly string[];
  /**
   * SET LOCAL ROLE for this transaction. Only for tooling that connects with the
   * migration credentials (seed, local scripts); runtime services log in as the role.
   */
  assumeRole?: RuntimeRole;
}

export const RUNTIME_ROLES = ['app_user', 'app_platform'] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];

/** Transaction settings (ADR-0011 section 2). Same values as TENANT_SETTINGS in @deemed/domain. */
export const SETTINGS = {
  organizationId: 'app.organization_id',
  actorId: 'app.actor_id',
  actorType: 'app.actor_type',
  requestId: 'app.request_id',
  siteIds: 'app.site_ids',
  roles: 'app.roles',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEY = /^[a-z][a-z0-9_]*$/;
const ACTOR_TYPES: readonly ActorType[] = [
  'user',
  'service',
  'integration',
  'system',
  'break_glass',
];
const HUMAN: readonly ActorType[] = ['user', 'break_glass'];

export class TenantContextError extends Error {
  override name = 'TenantContextError';
}

function assertUuid(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TenantContextError(`${name} must be a UUID`);
  }
}

function assertActor(actor: Actor): void {
  if (!ACTOR_TYPES.includes(actor.type)) throw new TenantContextError('actor.type is not valid');
  if (typeof actor.label !== 'string' || actor.label.trim() === '' || actor.label.length > 200) {
    throw new TenantContextError('actor.label is required (1 to 200 characters)');
  }
  if (actor.userId !== undefined) assertUuid('actor.userId', actor.userId);
  if (actor.personId !== undefined) assertUuid('actor.personId', actor.personId);
  if (actor.onBehalfOfId !== undefined) assertUuid('actor.onBehalfOfId', actor.onBehalfOfId);
  const human = HUMAN.includes(actor.type);
  if (human && actor.userId === undefined)
    throw new TenantContextError(`a ${actor.type} actor needs actor.userId`);
  if (!human && actor.userId !== undefined) {
    throw new TenantContextError(
      `a ${actor.type} actor cannot carry actor.userId; use onBehalfOfId`,
    );
  }
}

/** PostgreSQL array literal for app.site_ids / app.roles. Values are validated first. */
function arrayLiteral(
  values: readonly string[] | undefined,
  check: (v: string) => boolean,
  name: string,
): string {
  const list = values ?? [];
  for (const v of list)
    if (!check(v)) throw new TenantContextError(`${name} contains an invalid value`);
  return `{${list.join(',')}}`;
}

async function beginContext(
  tx: Tx,
  organizationId: string | null,
  actor: Actor,
  options: TransactionOptions,
): Promise<TransactionContext> {
  if (options.assumeRole !== undefined) {
    if (!RUNTIME_ROLES.includes(options.assumeRole)) {
      throw new TenantContextError('assumeRole is not a runtime role');
    }
    await tx.execute(sql.raw(`SET LOCAL ROLE ${options.assumeRole}`));
  }
  const requestId = options.requestId ?? randomUUID();
  assertUuid('requestId', requestId);
  const siteIds = arrayLiteral(options.siteIds, (v) => UUID.test(v), 'siteIds');
  const roles = arrayLiteral(options.roles, (v) => ROLE_KEY.test(v), 'roles');
  const actorId = HUMAN.includes(actor.type) ? (actor.userId ?? '') : '';
  if (organizationId !== null) {
    await tx.execute(sql`SELECT set_config(${SETTINGS.organizationId}, ${organizationId}, true)`);
  }
  await tx.execute(sql`
    SELECT set_config(${SETTINGS.actorId}, ${actorId}, true),
           set_config(${SETTINGS.actorType}, ${actor.type}, true),
           set_config(${SETTINGS.requestId}, ${requestId}, true),
           set_config(${SETTINGS.siteIds}, ${siteIds}, true),
           set_config(${SETTINGS.roles}, ${roles}, true)`);
  return { organizationId, actor, requestId };
}

/**
 * Runs fn in one transaction scoped to a tenant. RLS admits only that tenant's rows,
 * and writes for another tenant fail. Commits when fn resolves, rolls back when it throws.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  actor: Actor,
  fn: (tx: Tx, context: TransactionContext) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertUuid('tenantId', tenantId);
  assertActor(actor);
  return db.transaction(async (tx) => fn(tx, await beginContext(tx, tenantId, actor, options)));
}

/**
 * Runs fn in one transaction with an actor but no tenant, for app_platform work
 * (provisioning, tenant fan-out). Any tenant table touched here raises, because
 * app.organization_id is unset.
 */
export async function withPlatform<T>(
  db: Db,
  actor: Actor,
  fn: (tx: Tx, context: TransactionContext) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertActor(actor);
  return db.transaction(async (tx) => fn(tx, await beginContext(tx, null, actor, options)));
}

export interface DatabaseOptions {
  connectionString: string;
  /** Pool size (default 10). */
  max?: number;
  /** Applied to every transaction; see TransactionOptions.assumeRole. */
  assumeRole?: RuntimeRole;
  applicationName?: string;
}

type ContextOptions = Omit<TransactionOptions, 'assumeRole'>;

export interface Database {
  readonly db: Db;
  readonly pool: pg.Pool;
  withTenant<T>(
    tenantId: string,
    actor: Actor,
    fn: (tx: Tx, context: TransactionContext) => Promise<T>,
    options?: ContextOptions,
  ): Promise<T>;
  withPlatform<T>(
    actor: Actor,
    fn: (tx: Tx, context: TransactionContext) => Promise<T>,
    options?: ContextOptions,
  ): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'deemed-health',
  });
  const db = drizzle(pool, { schema });
  const roleOption: TransactionOptions =
    options.assumeRole === undefined ? {} : { assumeRole: options.assumeRole };
  return {
    db,
    pool,
    withTenant: (tenantId, actor, fn, txOptions = {}) =>
      withTenant(db, tenantId, actor, fn, { ...txOptions, ...roleOption }),
    withPlatform: (actor, fn, txOptions = {}) =>
      withPlatform(db, actor, fn, { ...txOptions, ...roleOption }),
    close: () => pool.end(),
  };
}
