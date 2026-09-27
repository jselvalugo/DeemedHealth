/**
 * Schema guarantees: no SSN-like column (D1), every column classified, Drizzle schema in
 * step with the migrations, temporal and human-only rules, and the synthetic seed.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { detectSsnLikeColumns } from '@deemed/domain';
import { isTestNpi, isValidNpi, makeTestNpi } from '@deemed/test-fixtures/npi';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_DICTIONARY, renderDataDictionaryMarkdown } from '../src/data-dictionary.js';
import * as schema from '../src/schema/index.js';
import { XYZ_FIXTURE } from '../seed/fixtures.js';
import { SeedRefusedError, assertSeedAllowed, runSeed } from '../seed/seed.js';
import {
  APP_SCHEMAS,
  attempt,
  connect,
  describeDb,
  expectPgError,
  inRollback,
  need,
  setTenant,
} from './helpers.js';

const DICTIONARY_DOC = fileURLToPath(
  new URL('../../../docs/data/data-dictionary.md', import.meta.url),
);

function drizzleTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
}

describe('seed guard', () => {
  it('refuses DH_ENV=production and a missing or unknown DH_ENV', () => {
    expect(() => assertSeedAllowed('production')).toThrow(SeedRefusedError);
    expect(() => assertSeedAllowed(undefined)).toThrow(SeedRefusedError);
    expect(() => assertSeedAllowed('prod')).toThrow(SeedRefusedError);
    expect(() => assertSeedAllowed('local')).not.toThrow();
    expect(() => assertSeedAllowed('development')).not.toThrow();
  });

  it('refuses before connecting to any database', async () => {
    await expect(
      runSeed({
        connectionString: 'postgres://nobody@127.0.0.1:1/none',
        dhEnv: 'production',
        fixtures: [XYZ_FIXTURE],
      }),
    ).rejects.toThrow(SeedRefusedError);
  });
});

describe('data dictionary', () => {
  it('docs/data/data-dictionary.md is generated from src/data-dictionary.ts', async () => {
    expect(await readFile(DICTIONARY_DOC, 'utf8')).toBe(renderDataDictionaryMarkdown());
  });

  it('has no SSN-like column name, and field-encrypted columns are PII or PHI', () => {
    const names = Object.values(DATA_DICTIONARY).flatMap((t) => Object.keys(t.columns));
    expect(detectSsnLikeColumns(names.map((name) => ({ name })))).toEqual([]);
    for (const [table, entry] of Object.entries(DATA_DICTIONARY)) {
      for (const [column, c] of Object.entries(entry.columns)) {
        if (c.encryption) expect(['PII', 'PHI'], `${table}.${column}`).toContain(c.class);
      }
    }
  });

  it('Drizzle schema has no SSN-like column', () => {
    const columns = drizzleTables().flatMap((t) =>
      getTableConfig(t).columns.map((c) => ({ name: c.name })),
    );
    expect(columns.length).toBeGreaterThan(50);
    expect(detectSsnLikeColumns(columns)).toEqual([]);
  });
});

describeDb('schema against the database', () => {
  let admin: pg.Client;
  let user: pg.Client;

  beforeAll(async () => {
    const c = need();
    admin = await connect(c.adminUrl);
    user = await connect(c.appUserUrl);
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), user?.end()]);
  });

  it('has no SSN-like column in any schema (decision D1)', async () => {
    const { rows } = await admin.query<{ name: string; qualified: string }>(
      `SELECT column_name AS name, table_schema || '.' || table_name || '.' || column_name AS qualified
       FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'`,
    );
    expect(rows.length).toBeGreaterThan(100);
    const findings = detectSsnLikeColumns(rows.map((r) => ({ name: r.name })));
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });

  it('classifies every column of every application table in the data dictionary, and nothing else', async () => {
    const { rows } = await admin.query<{ tbl: string; col: string }>(
      `SELECT n.nspname || '.' || c.relname AS tbl, a.attname AS col
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       ORDER BY 1, a.attnum`,
      [APP_SCHEMAS],
    );
    const inDb = rows.map((r) => `${r.tbl}.${r.col}`).sort();
    const inDictionary = Object.entries(DATA_DICTIONARY)
      .flatMap(([table, entry]) => Object.keys(entry.columns).map((c) => `${table}.${c}`))
      .sort();
    expect(inDictionary).toEqual(inDb);
  });

  it('keeps the Drizzle schema in step with the migrations (columns and nullability)', async () => {
    for (const table of drizzleTables()) {
      const config = getTableConfig(table);
      const schemaName = config.schema ?? 'public';
      const { rows } = await admin.query<{ name: string; not_null: boolean }>(
        `SELECT column_name AS name, is_nullable = 'NO' AS not_null FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schemaName, config.name],
      );
      const db = Object.fromEntries(rows.map((r) => [r.name, r.not_null]));
      const drizzle = Object.fromEntries(config.columns.map((c) => [c.name, c.notNull]));
      expect(drizzle, `${schemaName}.${config.name}`).toEqual(db);
    }
  });

  it('seeds XYZ Community Health Center as synthetic data: 3 Florida sites, 2 Eastern and 1 Central', async () => {
    const c = need();
    const org = c.tenants.xyz.organizationId;
    const orgRow = await admin.query(
      `SELECT legal_name, state, is_test_record, npi FROM public.organization WHERE id = $1`,
      [org],
    );
    expect(orgRow.rows[0]).toMatchObject({
      legal_name: 'XYZ Community Health Center',
      state: 'FL',
      is_test_record: true,
    });
    expect(isValidNpi(orgRow.rows[0].npi)).toBe(true);

    const sites = await admin.query<{ time_zone: string; n: string }>(
      `SELECT time_zone, count(*) AS n FROM public.site WHERE organization_id = $1 AND state = 'FL' AND is_test_record GROUP BY 1 ORDER BY 1`,
      [org],
    );
    expect(sites.rows).toEqual([
      { time_zone: 'America/Chicago', n: '1' },
      { time_zone: 'America/New_York', n: '2' },
    ]);

    const notTest = await admin.query(
      `SELECT 'person' FROM public.person WHERE NOT is_test_record
       UNION ALL SELECT 'user_account' FROM public.user_account WHERE NOT is_test_record
       UNION ALL SELECT 'site' FROM public.site WHERE NOT is_test_record
       UNION ALL SELECT 'organization' FROM public.organization WHERE NOT is_test_record`,
    );
    expect(notTest.rowCount).toBe(0);

    const npis = await admin.query<{ npi: string }>(
      `SELECT npi FROM public.person WHERE npi IS NOT NULL`,
    );
    expect(npis.rowCount).toBeGreaterThanOrEqual(2);
    for (const { npi } of npis.rows) {
      expect(isValidNpi(npi)).toBe(true);
      const seeds = [101, 102, 201];
      expect(
        seeds.some((s) => makeTestNpi(s, 1).value === npi && isTestNpi(makeTestNpi(s, 1))),
      ).toBe(true);
    }
  });

  it('is idempotent when the seed runs again', async () => {
    const results = await runSeed({
      connectionString: need().adminUrl,
      dhEnv: 'local',
      fixtures: [XYZ_FIXTURE],
    });
    expect(results[0]?.created).toBe(false);
  });

  describe('role assignments', () => {
    it('require an expiry of at most 30 days for the auditor role', async () => {
      const c = need();
      const org = c.tenants.xyz.organizationId;
      const auditor = c.tenants.xyz.userIds.auditor;
      await inRollback(user, async () => {
        await setTenant(user, org);
        const grant = (expires: string | null) =>
          attempt(user, () =>
            user.query(
              `INSERT INTO public.role_assignment (organization_id, user_account_id, role_key, expires_at)
               VALUES ($1, $2, 'auditor', ${expires === null ? 'NULL' : `now() + interval '${expires}'`})`,
              [org, auditor],
            ),
          );
        await expectPgError(grant(null), '23514');
        await expectPgError(grant('45 days'), '23514');
        await grant('14 days');
      });
    });

    it('are never edited in place: only a one-way revoke is allowed', async () => {
      const c = need();
      const org = c.tenants.xyz.organizationId;
      await inRollback(user, async () => {
        await setTenant(user, org, c.tenants.xyz.userIds.admin);
        const { rows } = await user.query<{ id: string }>(
          `SELECT id FROM public.role_assignment WHERE role_key = 'credentialing_coordinator' AND site_id IS NOT NULL LIMIT 1`,
        );
        const id = rows[0]?.id;
        await expectPgError(
          attempt(user, () =>
            user.query(`UPDATE public.role_assignment SET site_id = NULL WHERE id = $1`, [id]),
          ),
          '23514',
        );
        await user.query(
          `UPDATE public.role_assignment SET revoked_at = now(), revoked_by = $2, revoke_reason = 'left role' WHERE id = $1`,
          [id, c.tenants.xyz.userIds.admin],
        );
        const active = await user.query(
          `SELECT 1 FROM public.v_active_role_assignment WHERE id = $1`,
          [id],
        );
        expect(active.rowCount).toBe(0);
        const meta = await user.query(
          `SELECT updated_by::text FROM public.role_assignment WHERE id = $1`,
          [id],
        );
        expect(meta.rows[0]).toEqual({ updated_by: c.tenants.xyz.userIds.admin });
        await expectPgError(
          attempt(user, () =>
            user.query(`UPDATE public.role_assignment SET revoke_reason = 'edited' WHERE id = $1`, [
              id,
            ]),
          ),
          '23514',
        );
      });
    });
  });

  describe('approvals (AI guides, humans decide)', () => {
    async function approvalAttempt(actorId: string, approverUser: string, approverPerson: string) {
      const c = need();
      const org = c.tenants.xyz.organizationId;
      await setTenant(user, org, actorId);
      return attempt(user, () =>
        user.query(
          `INSERT INTO public.approval (organization_id, subject_type, subject_id, approver_person_id, approver_user_account_id, decision)
           VALUES ($1, 'task', gen_random_uuid(), $2, $3, 'approved')`,
          [org, approverPerson, approverUser],
        ),
      );
    }

    it('accept an approval only from the approving human in their own session', async () => {
      const c = need();
      const { userIds, personIds } = c.tenants.xyz;
      await inRollback(user, async () => {
        await approvalAttempt(
          userIds.compliance as string,
          userIds.compliance as string,
          personIds.compliance as string,
        );
        // A service or system session (no app.actor_id), e.g. the AI assistant.
        await expectPgError(
          approvalAttempt('', userIds.compliance as string, personIds.compliance as string),
          '42501',
        );
        // Another human recording an approval in someone else's name.
        await expectPgError(
          approvalAttempt(
            userIds.ceo as string,
            userIds.compliance as string,
            personIds.compliance as string,
          ),
          '42501',
        );
        // The user account must belong to the approver person.
        await expectPgError(
          approvalAttempt(
            userIds.compliance as string,
            userIds.compliance as string,
            personIds.ceo as string,
          ),
          '23503',
        );
      });
    });

    it('cannot be changed or deleted by app_user', async () => {
      const c = need();
      await inRollback(user, async () => {
        await setTenant(user, c.tenants.xyz.organizationId);
        await expectPgError(
          attempt(user, () => user.query(`UPDATE public.approval SET decision = 'rejected'`)),
          '42501',
        );
        await expectPgError(
          attempt(user, () => user.query(`DELETE FROM public.approval`)),
          '42501',
        );
      });
    });
  });

  describe('row rules', () => {
    it('stamps created_by/updated_by from app.actor_id and keeps rows in their tenant', async () => {
      const c = need();
      const org = c.tenants.xyz.organizationId;
      await inRollback(user, async () => {
        await setTenant(user, org, c.tenants.xyz.userIds.admin);
        const { rows } = await user.query<{ created_by: string; updated_by: string }>(
          `INSERT INTO public.task (organization_id, title, created_by) VALUES ($1, 'Stamped task', gen_random_uuid())
           RETURNING created_by::text, updated_by::text`,
          [org],
        );
        expect(rows[0]).toEqual({
          created_by: c.tenants.xyz.userIds.admin,
          updated_by: c.tenants.xyz.userIds.admin,
        });
      });
    });

    it('requires a reason for "not applicable" and a subject in the same tenant', async () => {
      const c = need();
      const org = c.tenants.xyz.organizationId;
      await inRollback(user, async () => {
        await setTenant(user, org);
        const insert = (
          status: string,
          reason: string | null,
          subjectType: string,
          subjectId: string,
        ) =>
          attempt(user, () =>
            user.query(
              `INSERT INTO public.requirement_instance (organization_id, requirement_id, subject_type, subject_id, status, not_applicable_reason)
               VALUES ($1, 'CM-20-BOARD-COMPOSITION', $2, $3, $4, $5)`,
              [org, subjectType, subjectId, status, reason],
            ),
          );
        await expectPgError(insert('not_applicable', null, 'organization', org), '23514');
        await expectPgError(insert('not_applicable', '   ', 'organization', org), '23514');
        await insert(
          'not_applicable',
          'No board: public-agency co-applicant arrangement (synthetic)',
          'organization',
          org,
        );
        await expectPgError(
          insert('missing', null, 'organization', c.tenants.gulf.organizationId),
          '23503',
        );
        await expectPgError(
          insert('missing', null, 'site', c.tenants.gulf.siteIds.G1 as string),
          '23503',
        );
      });
    });
  });
});
