/**
 * ADR-0014 section 1: every sortable or filterable record field leads an index after
 * organization_id, so list queries (scope before paging, keyset pagination) stay on an
 * index at 10x seed volume. Checked against pg_indexes on the migrated database.
 */
import { recordTypes } from '@deemed/domain';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { attempt, connect, describeDb, expectPgError, need } from './helpers.js';

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

  it('sets archived_by from the transaction actor, and requires a human actor and a reason to archive', async () => {
    const c = need();
    const org = c.tenants.xyz.organizationId;
    const actor = c.tenants.xyz.userIds.compliance as string;
    const other = c.tenants.xyz.userIds.admin as string;
    const gulfUser = c.tenants.gulf.userIds.compliance as string;
    const user = await connect(c.appUserUrl);
    const as = (actorId: string) =>
      user.query(
        `SELECT set_config('app.organization_id', $1, true), set_config('app.actor_id', $2, true)`,
        [org, actorId],
      );
    try {
      await user.query('BEGIN');
      await as(actor);
      const { rows } = await user.query<{ id: string }>(
        `INSERT INTO public.site (organization_id, name, address_line1, city, postal_code, time_zone)
         VALUES ($1, 'Archive probe', '1 Probe Way', 'Tampa', '33601', 'America/New_York') RETURNING id`,
        [org],
      );
      const id = rows[0]?.id;
      // The caller names someone else; the database records the actor.
      const archived = await user.query<{ archived_by: string }>(
        `UPDATE public.site SET archived_at = now(), archived_by = $2, archive_reason = 'Duplicate'
         WHERE id = $1 RETURNING archived_by::text`,
        [id, other],
      );
      expect(archived.rows[0]?.archived_by).toBe(actor);
      // Later changes cannot rewrite who archived it.
      await as(other);
      const renamed = await user.query<{ archived_by: string }>(
        `UPDATE public.site SET name = 'Renamed', archived_by = $2 WHERE id = $1 RETURNING archived_by::text`,
        [id, other],
      );
      expect(renamed.rows[0]?.archived_by).toBe(actor);
      // Restoring clears it; archiving again stamps the new actor.
      const restored = await user.query<{ archived_by: string | null }>(
        `UPDATE public.site SET archived_at = NULL, archive_reason = NULL WHERE id = $1
         RETURNING archived_by::text`,
        [id],
      );
      expect(restored.rows[0]?.archived_by).toBeNull();
      // No reason, or no human actor: refused.
      await expectPgError(
        attempt(user, () =>
          user.query(`UPDATE public.site SET archived_at = now() WHERE id = $1`, [id]),
        ),
        '23514',
      );
      await as('');
      await expectPgError(
        attempt(user, () =>
          user.query(
            `UPDATE public.site SET archived_at = now(), archive_reason = 'x' WHERE id = $1`,
            [id],
          ),
        ),
        '23514',
      );
      // An actor from another tenant cannot be recorded (composite foreign key).
      await as(gulfUser);
      await expectPgError(
        attempt(user, () =>
          user.query(
            `UPDATE public.site SET archived_at = now(), archive_reason = 'x' WHERE id = $1`,
            [id],
          ),
        ),
        '23503',
      );
    } finally {
      await user.query('ROLLBACK');
      await user.end();
    }
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
