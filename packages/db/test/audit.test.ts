/**
 * Audit log (ADR-0008, G1): append-only, per-tenant hash chain that verifies, tamper
 * detection, identical canonical bytes in SQL and TypeScript, and the writer's rules.
 */
import { canonicalAuditRow, verifyAuditChain } from '@deemed/domain';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GOLDEN_CANONICAL, GOLDEN_ROW } from '../../domain/src/audit-canonical.test-utils.js';
import {
  AUDIT_EXPORT_COLUMNS,
  appendAuditEvent,
  exportAuditChain,
  toAuditRowExport,
  verifyAuditChainInDb,
  type RawAuditExportRow,
} from '../src/audit/index.js';
import { createDatabase, type Actor } from '../src/client.js';
import {
  attempt,
  connect,
  describeDb,
  expectPgError,
  inRollback,
  need,
  setTenant,
} from './helpers.js';

const SERVICE: Actor = { type: 'system', label: 'audit test' };

describeDb('audit log (ADR-0008)', () => {
  let admin: pg.Client;
  let user: pg.Client;
  let owner: pg.Client;
  let xyz: string;
  let gulf: string;

  beforeAll(async () => {
    const c = need();
    admin = await connect(c.adminUrl);
    user = await connect(c.appUserUrl);
    owner = await connect(c.ownerUrl);
    xyz = c.tenants.xyz.organizationId;
    gulf = c.tenants.gulf.organizationId;
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), user?.end(), owner?.end()]);
  });

  async function exportAsAdmin(org: string, client: pg.Client = admin) {
    const { rows } = await client.query<RawAuditExportRow>(
      `SELECT ${AUDIT_EXPORT_COLUMNS} FROM audit.audit_event WHERE organization_id = $1 ORDER BY chain_seq`,
      [org],
    );
    return rows.map(toAuditRowExport);
  }

  it('verifies each seeded chain in the database and in TypeScript, from a genesis row', async () => {
    const database = createDatabase({ connectionString: need().appUserUrl, max: 1 });
    try {
      for (const org of [xyz, gulf]) {
        const { sqlResult, rows } = await database.withTenant(org, SERVICE, async (tx) => ({
          sqlResult: await verifyAuditChainInDb(tx, org),
          rows: await exportAuditChain(tx, org),
        }));
        expect(sqlResult).toMatchObject({ ok: true, firstBadSeq: null });
        expect(rows.length).toBe(sqlResult.eventsChecked);
        expect(rows.length).toBeGreaterThan(5);
        expect(await verifyAuditChain(rows)).toMatchObject({
          ok: true,
          eventsChecked: rows.length,
        });

        const genesis = rows[0];
        expect(genesis).toMatchObject({
          chain_seq: 1,
          action: 'audit.genesis',
          category: 'system',
        });
        expect(genesis?.prev_hash).toBe('0'.repeat(64));
        expect(genesis?.reason).toBeTruthy();
      }
    } finally {
      await database.close();
    }
  });

  it('produces byte-identical canonical text in SQL and TypeScript for every stored row', async () => {
    // One event exercising inet, IPv6, Unicode, escapes, arrays, and decimals.
    const c = need();
    const database = createDatabase({ connectionString: c.appUserUrl, max: 1 });
    try {
      await database.withTenant(
        xyz,
        {
          type: 'user',
          userId: c.tenants.xyz.userIds.compliance as string,
          label: 'Tomás "T" Rivera\t✓',
        },
        (tx, ctx) =>
          appendAuditEvent(tx, ctx, {
            category: 'auth',
            action: 'session.login',
            ipAddress: '2001:db8::1',
            userAgent: 'Mozilla/5.0 (X11; Linux) Ünïcödé',
            requirementIds: ['CM-05-C&P-LIP-LICENSURE', 'FL-AHCA-SANC'],
            metadata: {
              mfa: 'webauthn',
              score: 0.75,
              attempts: 2,
              nested: { list: [1.5, 'ñ', null, true] },
            },
          }),
      );
      await database.withTenant(xyz, SERVICE, (tx, ctx) =>
        appendAuditEvent(tx, ctx, {
          category: 'integration',
          action: 'license_sync.complete',
          ipAddress: '192.0.2.10',
          metadata: { rows: 120, source: 'FL DOH MQA (synthetic)' },
        }),
      );
    } finally {
      await database.close();
    }

    const { rows } = await admin.query<RawAuditExportRow & { canonical: string }>(
      `SELECT audit.canonical_text(e) AS canonical, ${AUDIT_EXPORT_COLUMNS} FROM audit.audit_event e ORDER BY organization_id, chain_seq`,
    );
    expect(rows.length).toBeGreaterThan(10);
    for (const { canonical, ...raw } of rows) {
      expect(
        canonicalAuditRow(toAuditRowExport(raw)),
        `${raw.organization_id}#${raw.chain_seq}`,
      ).toBe(canonical);
    }
  });

  it('matches the golden canonical bytes shared with @deemed/domain', async () => {
    const row = {
      ...GOLDEN_ROW,
      prev_hash: `\\x${GOLDEN_ROW.prev_hash}`,
      row_hash: `\\x${'00'.repeat(32)}`,
    };
    const { rows } = await admin.query<{ canonical: string }>(
      `SELECT audit.canonical_text(jsonb_populate_record(NULL::audit.audit_event, $1::jsonb)) AS canonical`,
      [JSON.stringify(row)],
    );
    expect(rows[0]?.canonical).toBe(GOLDEN_CANONICAL);
  });

  it('denies app_user INSERT, UPDATE, DELETE, and TRUNCATE on audit tables', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      await expectPgError(
        attempt(user, () =>
          user.query(`UPDATE audit.audit_event SET reason = 'x' WHERE organization_id = $1`, [xyz]),
        ),
        '42501',
      );
      await expectPgError(
        attempt(user, () =>
          user.query(`DELETE FROM audit.audit_event WHERE organization_id = $1`, [xyz]),
        ),
        '42501',
      );
      await expectPgError(
        attempt(user, () => user.query('TRUNCATE audit.audit_event')),
        '42501',
      );
      await expectPgError(
        attempt(user, () =>
          user.query(
            `INSERT INTO audit.audit_event SELECT * FROM audit.audit_event WHERE organization_id = $1 LIMIT 1`,
            [xyz],
          ),
        ),
        '42501',
      );
      await expectPgError(
        attempt(user, () =>
          user.query(`UPDATE audit.chain_head SET chain_seq = 1 WHERE organization_id = $1`, [xyz]),
        ),
        '42501',
      );
      await expectPgError(
        attempt(user, () =>
          user.query(`DELETE FROM audit.chain_head WHERE organization_id = $1`, [xyz]),
        ),
        '42501',
      );
    });
    const { rows } = await admin.query<{ privilege: string }>(
      `SELECT privilege_type AS privilege FROM information_schema.role_table_grants
       WHERE grantee = 'app_user' AND table_schema = 'audit' AND privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });

  it('blocks UPDATE, DELETE, and TRUNCATE even for the table owner', async () => {
    await inRollback(owner, async () => {
      await setTenant(owner, xyz);
      const updateMessage = await expectPgError(
        attempt(owner, () =>
          owner.query(`UPDATE audit.audit_event SET reason = 'x' WHERE organization_id = $1`, [
            xyz,
          ]),
        ),
        '42501',
      );
      expect(updateMessage).toMatch(/append-only/);
      await expectPgError(
        attempt(owner, () =>
          owner.query(`DELETE FROM audit.audit_event WHERE organization_id = $1`, [xyz]),
        ),
        '42501',
      );
      await expectPgError(
        attempt(owner, () => owner.query('TRUNCATE audit.audit_event')),
        '42501',
      );
      const { rows } = await owner.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = 'audit.audit_event'::regclass ORDER BY 1 LIMIT 1`,
      );
      const partition = rows[0]?.name ?? '';
      const truncateMessage = await expectPgError(
        attempt(owner, () => owner.query(`TRUNCATE audit."${partition}"`)),
        '42501',
      );
      expect(truncateMessage).toMatch(/append-only/);
    });
  });

  it('detects a tampered row, a deleted row, and a rewritten head', async () => {
    // A database superuser bypassing triggers stands in for an attacker with DBA access.
    await inRollback(admin, async () => {
      await admin.query(`SET LOCAL session_replication_role = replica`);
      await admin.query(
        `UPDATE audit.audit_event SET actor_label = 'someone else' WHERE organization_id = $1 AND chain_seq = 3`,
        [xyz],
      );
      const sqlCheck = await admin.query(`SELECT * FROM audit.verify_chain($1)`, [xyz]);
      expect(sqlCheck.rows[0]).toMatchObject({
        ok: false,
        first_bad_seq: '3',
        detail: 'row_hash does not match the row content',
      });
      expect(await verifyAuditChain(await exportAsAdmin(xyz))).toMatchObject({
        ok: false,
        firstBadSeq: 3,
      });
    });
    await inRollback(admin, async () => {
      await admin.query(`SET LOCAL session_replication_role = replica`);
      await admin.query(
        `DELETE FROM audit.audit_event WHERE organization_id = $1 AND chain_seq = 4`,
        [xyz],
      );
      const sqlCheck = await admin.query(`SELECT * FROM audit.verify_chain($1)`, [xyz]);
      expect(sqlCheck.rows[0]).toMatchObject({
        ok: false,
        first_bad_seq: '4',
        detail: 'gap in chain_seq',
      });
      expect(await verifyAuditChain(await exportAsAdmin(xyz))).toMatchObject({
        ok: false,
        firstBadSeq: 4,
      });
    });
    await inRollback(admin, async () => {
      // Dropping the newest row and pointing the head at the new last row still fails
      // against a head that no longer matches; here the head is moved instead.
      await admin.query(
        `UPDATE audit.chain_head SET chain_seq = chain_seq + 1 WHERE organization_id = $1`,
        [xyz],
      );
      const sqlCheck = await admin.query(`SELECT * FROM audit.verify_chain($1)`, [xyz]);
      expect(sqlCheck.rows[0]).toMatchObject({
        ok: false,
        detail: 'chain_head does not match the last event',
      });
    });
    // Untouched after the rollbacks.
    expect((await admin.query(`SELECT ok FROM audit.verify_chain($1)`, [xyz])).rows[0]).toEqual({
      ok: true,
    });
  });

  it('keeps the chain gapless under concurrent appends', async () => {
    const database = createDatabase({ connectionString: need().appUserUrl, max: 8 });
    try {
      await Promise.all(
        Array.from({ length: 16 }, (_, i) =>
          database.withTenant(gulf, SERVICE, (tx, ctx) =>
            appendAuditEvent(tx, ctx, {
              category: 'integration',
              action: 'license_sync.complete',
              metadata: { batch: i, test: true },
            }),
          ),
        ),
      );
      const result = await database.withTenant(gulf, SERVICE, (tx) =>
        verifyAuditChainInDb(tx, gulf),
      );
      expect(result.ok).toBe(true);
    } finally {
      await database.close();
    }
  });

  it('takes the actor and request id from the transaction and the tenant from the session', async () => {
    const c = need();
    const database = createDatabase({ connectionString: c.appUserUrl, max: 1 });
    const userId = c.tenants.xyz.userIds.compliance as string;
    const personId = c.tenants.xyz.personIds.compliance as string;
    const requestId = '6f1c1c5e-8a2b-4c3d-9e4f-0a1b2c3d4e5f';
    try {
      const row = await database.withTenant(
        xyz,
        { type: 'user', userId, personId, label: 'María Delgado' },
        async (tx, ctx) => {
          const id = await appendAuditEvent(tx, ctx, {
            category: 'export',
            action: 'report.export',
            metadata: { format: 'csv', row_count: 12, test: true },
          });
          const r = await tx.execute<{
            actor_user_id: string;
            actor_person_id: string;
            request_id: string;
            actor_type: string;
          }>(
            sql`SELECT actor_user_id::text, actor_person_id::text, request_id::text, actor_type FROM audit.audit_event WHERE id = ${id}::uuid`,
          );
          return r.rows[0];
        },
        { requestId },
      );
      expect(row).toEqual({
        actor_user_id: userId,
        actor_person_id: personId,
        request_id: requestId,
        actor_type: 'user',
      });
    } finally {
      await database.close();
    }
  });

  it('rejects events that break the writer rules', async () => {
    const c = need();
    const append = (args: string, params: unknown[] = []) =>
      attempt(user, () => user.query(`SELECT audit.append_event(${args})`, params));
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      // Another tenant's chain.
      await expectPgError(
        append(`$1, 'system', 'audit.annotation', 'system', 'test', p_reason => 'x'`, [gulf]),
        '42501',
      );
      // Genesis is provisioning-only.
      await expectPgError(
        append(`$1, 'system', 'audit.genesis', 'system', 'test', p_reason => 'x'`, [xyz]),
        '42501',
      );
      // Unregistered action; wrong category.
      await expectPgError(
        append(`$1, 'system', 'made.up', 'system', 'test', p_reason => 'x'`, [xyz]),
        '23503',
      );
      await expectPgError(
        append(`$1, 'mutation', 'audit.annotation', 'system', 'test', p_reason => 'x'`, [xyz]),
        '23514',
      );
      // System events need a reason (ADR-0008), mutations need a target and a diff.
      await expectPgError(
        append(`$1, 'system', 'audit.annotation', 'system', 'test'`, [xyz]),
        '23514',
      );
      await expectPgError(
        append(
          `$1, 'mutation', 'task.update', 'system', 'test', p_target_table => 'task', p_target_id => gen_random_uuid()`,
          [xyz],
        ),
        '23514',
      );
      // Only humans approve; a service must name the human it acts for.
      await expectPgError(
        append(
          `$1, 'approval', 'approval.decide', 'service', 'Deemed Assistant', p_on_behalf_of_id => $2, p_target_table => 'approval', p_target_id => gen_random_uuid()`,
          [xyz, c.tenants.xyz.personIds.compliance],
        ),
        '42501',
      );
      await expectPgError(
        append(`$1, 'export', 'report.export', 'service', 'Deemed Assistant'`, [xyz]),
        '23514',
      );
      // A user actor needs app.actor_id in the transaction.
      await expectPgError(
        append(`$1, 'export', 'report.export', 'user', 'Someone'`, [xyz]),
        '23514',
      );
      // Decision D1: SSN-shaped values never enter the log (value assembled at runtime).
      const ssnShaped = ['000', '12', '3456'].join('-');
      await expectPgError(
        append(`$1, 'export', 'report.export', 'system', 'test', p_metadata => $2::jsonb`, [
          xyz,
          JSON.stringify({ note: ssnShaped }),
        ]),
        '23514',
      );
      // Canonical-form limits.
      await expectPgError(
        append(
          `$1, 'export', 'report.export', 'system', 'test', p_metadata => '{"bad key": 1}'::jsonb`,
          [xyz],
        ),
        '22023',
      );
      await expectPgError(
        append(
          `$1, 'export', 'report.export', 'system', 'test', p_metadata => '{"n": 0.30000000000000004}'::jsonb`,
          [xyz],
        ),
        '22023',
      );
    });
  });

  it('keeps partitions three months ahead, with no default partition', async () => {
    const { rows } = await admin.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = 'audit.audit_event'::regclass ORDER BY 1`,
    );
    const now = new Date();
    const expected = [0, 1, 2, 3].map((k) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
      return `audit_event_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(expected));
    const def = await admin.query(
      `SELECT 1 FROM pg_partitioned_table p WHERE p.partrelid = 'audit.audit_event'::regclass AND p.partdefid <> 0`,
    );
    expect(def.rowCount).toBe(0);

    const platform = await connect(need().platformUrl);
    try {
      expect((await platform.query(`SELECT audit.ensure_partitions(3) AS n`)).rows[0]).toEqual({
        n: 0,
      });
      await expectPgError(user.query(`SELECT audit.ensure_partitions(3)`), '42501');
    } finally {
      await platform.end();
    }
  });
});
