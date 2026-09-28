/**
 * ADR-0014 section 1: every sortable or filterable record field leads an index after
 * organization_id, so list queries (scope before paging, keyset pagination) stay on an
 * index at 10x seed volume. Checked against pg_indexes on the migrated database.
 */
import { recordTypes } from '@deemed/domain';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connect, describeDb, need } from './helpers.js';

describeDb('record type indexes', () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = await connect(need().adminUrl);
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('has an (organization_id, <column>) index for every sortable or filterable field', async () => {
    const { rows } = await admin.query<{ tbl: string; cols: string[] }>(`
      SELECT n.nspname || '.' || t.relname AS tbl,
             ARRAY(SELECT a.attname::text
                   FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                   ORDER BY k.ord) AS cols
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname IN ('public', 'audit')`);
    const leading = new Set(
      rows
        .filter((r) => r.cols[0] === 'organization_id' && r.cols[1])
        .map((r) => `${r.tbl}.${r.cols[1]}`),
    );
    const missing: string[] = [];
    for (const def of recordTypes()) {
      for (const [name, f] of Object.entries(def.fields)) {
        if (!f.sortable && !f.filterable) continue;
        if (!leading.has(`${def.table}.${f.column}`))
          missing.push(`${def.id}.${name} (${f.column})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('indexes record history by (organization_id, target_table, target_id, occurred_at)', async () => {
    const { rows } = await admin.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'audit' AND tablename = 'audit_event'`,
    );
    expect(rows.map((r) => r.indexdef)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('(organization_id, target_table, target_id, occurred_at)'),
      ]),
    );
  });

  it('increments row_version on every update and starts it at 1 whatever the caller sends', async () => {
    const c = need();
    const org = c.tenants.xyz.organizationId;
    const user = await connect(c.appUserUrl);
    try {
      await user.query('BEGIN');
      await user.query(`SELECT set_config('app.organization_id', $1, true)`, [org]);
      const inserted = await user.query<{ id: string; row_version: number }>(
        `INSERT INTO public.site (organization_id, name, address_line1, city, postal_code, time_zone, row_version)
         VALUES ($1, 'Row version probe', '1 Probe Way', 'Tampa', '33601', 'America/New_York', 41)
         RETURNING id, row_version`,
        [org],
      );
      expect(inserted.rows[0]?.row_version).toBe(1);
      const id = inserted.rows[0]?.id;
      const once = await user.query<{ row_version: number }>(
        `UPDATE public.site SET name = 'Probe 2', row_version = 99 WHERE id = $1 RETURNING row_version`,
        [id],
      );
      expect(once.rows[0]?.row_version).toBe(2);
      const twice = await user.query<{ row_version: number }>(
        `UPDATE public.site SET city = 'Miami' WHERE id = $1 RETURNING row_version`,
        [id],
      );
      expect(twice.rows[0]?.row_version).toBe(3);
      // Tables without the column (approval, the auth tables) share the trigger; the
      // seed's approval and session inserts exercise that path.
    } finally {
      await user.query('ROLLBACK');
      await user.end();
    }
  });
});
