/**
 * Tenant isolation (ADR-0002 section 10, G1). Tenant tables are discovered from
 * pg_catalog, so a new table is covered, or fails the build, without editing this file.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TenantContextError, createDatabase } from '../src/client.js';
import {
  APP_SCHEMAS,
  attempt,
  connect,
  describeDb,
  discoverTenantTables,
  expectPgError,
  inRollback,
  need,
  qualified,
  setTenant,
  type TenantTable,
} from './helpers.js';

/** Reviewed non-tenant tables. Adding one here needs data-architect and security review. */
const GLOBAL_TABLES = ['public.role', 'audit.action_registry'];
const PLATFORM_TABLES = ['platform.tenant'];

const EXPECTED_TENANT_TABLES = [
  'audit.audit_event',
  'audit.chain_head',
  'public.approval',
  'public.organization',
  'public.person',
  'public.requirement_instance',
  'public.role_assignment',
  'public.site',
  'public.task',
  'public.user_account',
];

describeDb('tenant isolation (ADR-0002)', () => {
  let admin: pg.Client;
  let user: pg.Client;
  let tables: TenantTable[];
  let xyz: string;
  let gulf: string;

  beforeAll(async () => {
    const c = need();
    admin = await connect(c.adminUrl);
    user = await connect(c.appUserUrl);
    tables = await discoverTenantTables(admin);
    xyz = c.tenants.xyz.organizationId;
    gulf = c.tenants.gulf.organizationId;
  });

  afterAll(async () => {
    await admin?.end();
    await user?.end();
  });

  it('discovers every tenant table from the catalog', () => {
    expect(tables.map((t) => `${t.schema}.${t.table}`)).toEqual(EXPECTED_TENANT_TABLES);
  });

  it('classifies every application table as tenant, global, or platform', async () => {
    const { rows } = await admin.query<{ name: string }>(
      `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition ORDER BY 1`,
      [APP_SCHEMAS],
    );
    const tenant = new Set(tables.map((t) => `${t.schema}.${t.table}`));
    const unclassified = rows
      .map((r) => r.name)
      .filter((n) => !tenant.has(n) && !GLOBAL_TABLES.includes(n) && !PLATFORM_TABLES.includes(n));
    expect(
      unclassified,
      'tables with no organization_id that are not reviewed global/platform tables',
    ).toEqual([]);
  });

  it('forces RLS on every tenant table with a policy on app.organization_id (no missing_ok)', async () => {
    for (const t of tables) {
      const { rows } = await admin.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
        [qualified(t)],
      );
      expect(rows[0], qualified(t)).toEqual({ enabled: true, forced: true });

      const policies = await admin.query<{
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(`SELECT cmd, qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2`, [
        t.schema,
        t.table,
      ]);
      expect(policies.rows.length, `${qualified(t)} has no policy`).toBeGreaterThan(0);
      for (const p of policies.rows) {
        expect(p.cmd, qualified(t)).toBe('ALL');
        for (const expr of [p.qual, p.with_check]) {
          expect(expr, qualified(t)).toMatch(
            new RegExp(
              `\\b${t.key} = \\(current_setting\\('app\\.organization_id'::text\\)\\)::uuid`,
            ),
          );
          expect(expr, `${qualified(t)} uses missing_ok`).not.toMatch(
            /current_setting\([^)]*,\s*true\)/,
          );
        }
      }
    }
  });

  it('forces RLS on every audit partition and grants runtime roles nothing on them', async () => {
    const { rows } = await admin.query<{
      name: string;
      forced: boolean;
      user_select: boolean;
      platform_select: boolean;
    }>(
      `SELECT c.relname AS name, c.relforcerowsecurity AS forced,
              has_table_privilege('app_user', c.oid, 'SELECT') AS user_select,
              has_table_privilege('app_platform', c.oid, 'SELECT') AS platform_select
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = 'audit.audit_event'::regclass`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows)
      expect(r, r.name).toMatchObject({ forced: true, user_select: false, platform_select: false });
  });

  it('gives no runtime role superuser or BYPASSRLS', async () => {
    const { rows } = await admin.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
       WHERE rolname IN ('app_owner', 'app_user', 'app_platform', 'audit_writer') ORDER BY 1`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows)
      expect(r, r.rolname).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('has seeded rows for both tenants in every tenant table, so the checks below are meaningful', async () => {
    for (const t of tables) {
      for (const org of [xyz, gulf]) {
        const { rows } = await admin.query<{ n: string }>(
          `SELECT count(*) AS n FROM ${qualified(t)} WHERE ${t.key} = $1`,
          [org],
        );
        expect(Number(rows[0]?.n), `${qualified(t)} has no rows for ${org}`).toBeGreaterThan(0);
      }
    }
  });

  it('returns no other-tenant rows from any tenant table', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      for (const t of tables) {
        const { rows } = await user.query<{ own: string; other: string }>(
          `SELECT count(*) FILTER (WHERE ${t.key} = $1) AS own,
                  count(*) FILTER (WHERE ${t.key} <> $1) AS other
           FROM ${qualified(t)}`,
          [xyz],
        );
        expect(Number(rows[0]?.own), `${qualified(t)} own rows`).toBeGreaterThan(0);
        expect(Number(rows[0]?.other), `${qualified(t)} leaked rows`).toBe(0);
        const direct = await user.query(`SELECT 1 FROM ${qualified(t)} WHERE ${t.key} = $1`, [
          gulf,
        ]);
        expect(direct.rowCount, `${qualified(t)} direct read of the other tenant`).toBe(0);
      }
    });
  });

  it('rejects a cross-tenant insert into every tenant table', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      for (const t of tables) {
        // Clone a valid row of the current tenant (read as admin) and point it at the other tenant.
        const { rows } = await admin.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(x) AS row FROM ${qualified(t)} x WHERE ${t.key} = $1 LIMIT 1`,
          [xyz],
        );
        const clone = { ...(rows[0]?.row ?? {}) };
        clone[t.key] = gulf;
        if ('id' in clone && t.key !== 'id') clone.id = randomUUID();
        const message = await expectPgError(
          attempt(user, () =>
            user.query(
              `INSERT INTO ${qualified(t)} SELECT * FROM jsonb_populate_record(NULL::${qualified(t)}, $1)`,
              [clone],
            ),
          ),
          '42501',
        );
        expect(message, qualified(t)).toMatch(/row-level security|permission denied/);
      }
    });
  });

  it('updates nothing in another tenant and cannot move a row to another tenant', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      for (const t of tables) {
        const canUpdate = (
          await admin.query<{ ok: boolean }>(
            `SELECT has_table_privilege('app_user', $1, 'UPDATE') AS ok`,
            [qualified(t)],
          )
        ).rows[0]?.ok;
        if (!canUpdate) {
          await expectPgError(
            attempt(user, () =>
              user.query(`UPDATE ${qualified(t)} SET ${t.key} = ${t.key} WHERE ${t.key} = $1`, [
                gulf,
              ]),
            ),
            '42501',
          );
          continue;
        }
        const result = await attempt(user, () =>
          user.query(`UPDATE ${qualified(t)} SET ${t.key} = ${t.key} WHERE ${t.key} = $1`, [gulf]),
        );
        expect(result.rowCount, `${qualified(t)} updated another tenant's rows`).toBe(0);
        if (t.key === 'organization_id') {
          await expectPgError(
            attempt(user, () =>
              user.query(
                `UPDATE ${qualified(t)} SET organization_id = $2
                 WHERE ctid = (SELECT ctid FROM ${qualified(t)} WHERE organization_id = $1 LIMIT 1)`,
                [xyz, gulf],
              ),
            ),
            ['42501', '23514'],
          );
        }
      }
    });
  });

  it('deletes nothing from any tenant table (no DELETE privilege; soft delete only)', async () => {
    const counts = async () => {
      const out: (number | null)[] = [];
      for (const t of tables) {
        out.push(
          (await admin.query(`SELECT 1 FROM ${qualified(t)} WHERE ${t.key} = $1`, [gulf])).rowCount,
        );
      }
      return out;
    };
    const before = await counts();
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      for (const t of tables) {
        await expectPgError(
          attempt(user, () =>
            user.query(`DELETE FROM ${qualified(t)} WHERE ${t.key} = $1`, [gulf]),
          ),
          '42501',
        );
      }
    });
    expect(await counts()).toEqual(before);
  });

  it('raises, rather than returning nothing, when a query has no tenant context', async () => {
    const fresh = await connect(need().appUserUrl);
    try {
      // A session that never set the variable: current_setting() raises "unrecognized configuration parameter".
      for (const t of tables) {
        await expectPgError(fresh.query(`SELECT count(*) FROM ${qualified(t)}`), '42704');
      }
      // A pooled session after a withTenant-style transaction: the setting reverts to ''
      // and the uuid cast raises.
      await inRollback(fresh, () => setTenant(fresh, xyz));
      for (const t of tables) {
        await expectPgError(fresh.query(`SELECT count(*) FROM ${qualified(t)}`), '22P02');
      }
    } finally {
      await fresh.end();
    }
  });

  it('blocks references to another tenant through composite foreign keys', async () => {
    const c = need();
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      const gulfSite = Object.values(c.tenants.gulf.siteIds)[0];
      await expectPgError(
        attempt(user, () =>
          user.query(
            `INSERT INTO public.task (organization_id, title, site_id) VALUES ($1, 'probe', $2)`,
            [xyz, gulfSite],
          ),
        ),
        '23503',
      );
      const gulfPerson = Object.values(c.tenants.gulf.personIds)[0];
      await expectPgError(
        attempt(user, () =>
          user.query(
            `INSERT INTO public.requirement_instance (organization_id, requirement_id, subject_type, subject_id)
             VALUES ($1, 'CM-05-C&P-LIP-LICENSURE', 'person', $2)`,
            [xyz, gulfPerson],
          ),
        ),
        '23503',
      );
    });
  });

  it('gives app_platform no direct access to any tenant table', async () => {
    const platform = await connect(need().platformUrl);
    try {
      // With a tenant set, planning gets past the policy expression and reaches the
      // privilege check (without one, the query already fails on the missing setting).
      await inRollback(platform, async () => {
        await setTenant(platform, xyz);
        for (const t of tables) {
          await expectPgError(
            attempt(platform, () => platform.query(`SELECT 1 FROM ${qualified(t)} LIMIT 1`)),
            '42501',
          );
        }
        await expectPgError(
          attempt(platform, () => platform.query('SELECT 1 FROM platform.tenant LIMIT 1')),
          '42501',
        );
      });
      for (const t of tables) {
        const { rows } = await admin.query<{ any: boolean }>(
          `SELECT has_table_privilege('app_platform', $1, 'SELECT') OR has_table_privilege('app_platform', $1, 'INSERT')
               OR has_table_privilege('app_platform', $1, 'UPDATE') OR has_table_privilege('app_platform', $1, 'DELETE') AS any`,
          [qualified(t)],
        );
        expect(rows[0]?.any, qualified(t)).toBe(false);
      }
    } finally {
      await platform.end();
    }
  });
});

describeDb('withTenant()', () => {
  it('scopes every query to one tenant and leaves no context on the pooled connection', async () => {
    const c = need();
    const database = createDatabase({ connectionString: c.appUserUrl, max: 1 });
    const actor = { type: 'system' as const, label: 'withTenant test' };
    try {
      const count = (tenant: string) =>
        database.withTenant(tenant, actor, async (tx) => {
          const r = await tx.execute<{ n: string }>(sql`SELECT count(*) AS n FROM public.site`);
          return Number(r.rows[0]?.n);
        });
      expect(await count(c.tenants.xyz.organizationId)).toBe(3);
      expect(await count(c.tenants.gulf.organizationId)).toBe(1);

      // Same single pooled connection: the transaction-local settings are gone.
      const after = await database.pool.query<Record<string, string | null>>(
        `SELECT current_setting('app.organization_id', true) AS org, current_setting('app.actor_id', true) AS actor,
                current_setting('app.request_id', true) AS request, current_setting('app.site_ids', true) AS sites,
                current_setting('app.roles', true) AS roles`,
      );
      expect(after.rows[0]).toEqual({ org: '', actor: '', request: '', sites: '', roles: '' });
      await expectPgError(database.pool.query('SELECT count(*) FROM public.site'), '22P02');
    } finally {
      await database.close();
    }
  });

  it('rolls back everything when the callback throws', async () => {
    const c = need();
    const database = createDatabase({ connectionString: c.appUserUrl, max: 1 });
    const org = c.tenants.xyz.organizationId;
    const actor = { type: 'system' as const, label: 'rollback test' };
    try {
      await expect(
        database.withTenant(org, actor, async (tx) => {
          await tx.execute(
            sql`UPDATE public.site SET name = 'renamed in a failed transaction' WHERE organization_id = ${org}`,
          );
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const names = await database.withTenant(org, actor, async (tx) =>
        (await tx.execute<{ name: string }>(sql`SELECT name FROM public.site`)).rows.map(
          (r) => r.name,
        ),
      );
      expect(names).not.toContain('renamed in a failed transaction');
    } finally {
      await database.close();
    }
  });

  it('rejects a malformed tenant id or actor before touching the database', async () => {
    const database = createDatabase({ connectionString: need().appUserUrl, max: 1 });
    try {
      await expect(
        database.withTenant("x' OR true --", { type: 'system', label: 't' }, async () => 1),
      ).rejects.toThrow(TenantContextError);
      await expect(
        database.withTenant(
          need().tenants.xyz.organizationId,
          { type: 'user', label: 'no id' },
          async () => 1,
        ),
      ).rejects.toThrow(TenantContextError);
    } finally {
      await database.close();
    }
  });
});
