import pg from 'pg';
import { describe, expect, inject } from 'vitest';
import type { DbTestContext } from './context.js';
import './context.js';

export const ctx: DbTestContext = inject('db');

/** describe() when a database is available, describe.skip() otherwise. */
export const describeDb = ctx.available ? describe : describe.skip;

type RequiredCtx = Required<
  Pick<DbTestContext, 'adminUrl' | 'appUserUrl' | 'platformUrl' | 'ownerUrl' | 'tenants'>
>;

export function need(): RequiredCtx {
  if (
    !ctx.available ||
    !ctx.adminUrl ||
    !ctx.appUserUrl ||
    !ctx.platformUrl ||
    !ctx.ownerUrl ||
    !ctx.tenants
  ) {
    throw new Error('database test context is not available');
  }
  return ctx as RequiredCtx;
}

/** A single connection, closed by the returned function. */
export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs fn inside BEGIN ... ROLLBACK, so nothing a test does persists. */
export async function inRollback<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Sets the transaction settings the way withTenant does (ADR-0011). */
export async function setTenant(
  client: pg.Client,
  organizationId: string,
  actorId = '',
): Promise<void> {
  await client.query(
    `SELECT set_config('app.organization_id', $1, true),
            set_config('app.actor_id', $2, true),
            set_config('app.request_id', gen_random_uuid()::text, true)`,
    [organizationId, actorId],
  );
}

/** Asserts the promise rejects with the given SQLSTATE; returns the error message. */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string | readonly string[],
): Promise<string> {
  const codes = typeof code === 'string' ? [code] : code;
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message: string };
    expect(codes, `unexpected SQLSTATE ${e.code}: ${e.message}`).toContain(e.code);
    return e.message;
  }
  throw new Error(`expected SQLSTATE ${codes.join('/')}, but the statement succeeded`);
}

/** Runs fn inside a SAVEPOINT and rolls back to it (so a failed statement does not abort the transaction). */
export async function attempt<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('SAVEPOINT attempt');
  try {
    const result = await fn();
    await client.query('RELEASE SAVEPOINT attempt');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    throw error;
  }
}

export interface TenantTable {
  schema: string;
  table: string;
  /** Column holding the tenant id: organization_id, or id for public.organization. */
  key: string;
}

/** Schemas whose tables belong to the application (tenant, global, and platform tables). */
export const APP_SCHEMAS = ['public', 'audit', 'auth', 'platform'] as const;

/**
 * Tenant tables discovered from pg_catalog: every ordinary or partitioned (not partition)
 * table in public/audit/auth with an organization_id column, plus public.organization.
 */
export async function discoverTenantTables(client: pg.Client): Promise<TenantTable[]> {
  const { rows } = await client.query<{ schema: string; table: string; key: string }>(`
    SELECT n.nspname AS schema, c.relname AS table,
           CASE WHEN n.nspname = 'public' AND c.relname = 'organization' THEN 'id' ELSE 'organization_id' END AS key
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'audit', 'auth')
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND (EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
           OR (n.nspname = 'public' AND c.relname = 'organization'))
    ORDER BY 1, 2`);
  return rows;
}

export const qualified = (t: { schema: string; table: string }) => `"${t.schema}"."${t.table}"`;
