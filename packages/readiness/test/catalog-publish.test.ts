/**
 * Catalog publish job and the production constraint (ADR-0003 rules 3, 8, 11; G1-8).
 * The shared test database is non-production; the production cases run inside a
 * transaction that marks the database production and is rolled back.
 */
import { createDatabase, migrate } from '@deemed/db';
import { sql } from 'drizzle-orm';
import { compileCatalog, loadCatalogSources } from '@deemed/requirements-catalog/compiler';
import {
  ReadinessError,
  publishCatalogBundle,
  runCatalogPublishJob,
  verifyBundle,
} from '@deemed/readiness/service';
import { FX_CAT_ENTRIES } from '@deemed/test-fixtures/catalog';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { attempt, connect, describeDb, expectPgError, need } from '../../db/test/helpers.js';
import { SYSTEM, fxBundles, nextCatalogVersion, pgError, startWorld, type World } from './world.js';

describeDb('catalog publish job (app_platform)', () => {
  let w: World;
  beforeAll(async () => {
    w = await startWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  it('loads a non-production bundle into the global tables, keyed by catalogVersion; republishing is a no-op', async () => {
    const version = await nextCatalogVersion(w.admin);
    const { nonProduction, production } = fxBundles(version);
    const first = await runCatalogPublishJob({
      platform: w.platform,
      bundles: { non_production: nonProduction, production },
    });
    expect(first).toMatchObject({
      catalogVersion: version,
      channel: 'non_production',
      created: true,
    });
    expect(first.entryCount).toBe(Object.keys(FX_CAT_ENTRIES).length);
    // A new release fans out one recompute per active tenant.
    expect(first.recomputesEnqueued).toBeGreaterThanOrEqual(2);
    const rows = await w.admin.query(
      `SELECT rv.requirement_id, rv.status, rv.channel, r.content_hash
       FROM catalog.requirement_version rv JOIN catalog.catalog_release r ON r.id = rv.catalog_release_id
       WHERE r.catalog_version = $1 ORDER BY 1`,
      [version],
    );
    expect(rows.rows.map((r) => r.requirement_id)).toEqual(
      Object.values(FX_CAT_ENTRIES)
        .map((e) => e.id)
        .sort(),
    );
    expect(rows.rows[0]).toMatchObject({
      channel: 'non_production',
      content_hash: nonProduction.contentHash,
    });
    const again = await runCatalogPublishJob({
      platform: w.platform,
      bundles: { non_production: nonProduction },
    });
    expect(again).toMatchObject({
      releaseId: first.releaseId,
      created: false,
      recomputesEnqueued: 0,
    });
    // Keep the fan-out from reaching other files' tenants.
    await w.admin.query(
      `UPDATE platform.job SET state = 'superseded', finished_at = now()
       WHERE queue = 'readiness.recompute' AND state = 'queued' AND payload ->> 'catalogVersion' = $1`,
      [version],
    );
  });

  it('never edits a released version: other content under the same version, or a lower version, is refused', async () => {
    const version = await nextCatalogVersion(w.admin);
    const { nonProduction } = fxBundles(version);
    await w.platform.withPlatform(SYSTEM, (tx) => publishCatalogBundle(tx, nonProduction, 'test'));
    const changed = fxBundles(version, [
      { ...FX_CAT_ENTRIES.license, severity: 'low' },
    ]).nonProduction;
    expect(
      await pgError(
        w.platform.withPlatform(SYSTEM, (tx) => publishCatalogBundle(tx, changed, 'test')),
      ),
    ).toMatchObject({ code: '23505' });
    const lower = fxBundles('1.0.0').nonProduction;
    expect(
      await pgError(
        w.platform.withPlatform(SYSTEM, (tx) => publishCatalogBundle(tx, lower, 'test')),
      ),
    ).toMatchObject({ code: '23514' });
    // Released rows are immutable for every role, the owner included.
    const owner = await connect(need().ownerUrl);
    try {
      await expectPgError(
        owner.query(
          `UPDATE catalog.requirement_version SET title = 'edited' WHERE channel = 'non_production'`,
        ),
        '42501',
      );
      await expectPgError(owner.query(`DELETE FROM catalog.catalog_release`), '42501');
    } finally {
      await owner.end();
    }
  });

  it('gives tenants read-only catalog access and nobody but app_platform the publish function', async () => {
    const user = await connect(need().appUserUrl);
    try {
      const r = await user.query('SELECT count(*)::int AS n FROM catalog.requirement_version');
      expect(r.rows[0].n).toBeGreaterThan(0);
      await expectPgError(
        user.query(`INSERT INTO catalog.requirement (id, jurisdiction, first_release_id)
                    SELECT 'TEST-99-X', 'federal', id FROM catalog.catalog_release LIMIT 1`),
        '42501',
      );
      await expectPgError(user.query(`SELECT catalog.publish_release('{}'::jsonb, 'x')`), '42501');
      await expectPgError(
        user.query(`SELECT catalog.set_database_channel('production', 'x')`),
        '42501',
      );
    } finally {
      await user.end();
    }
    const platform = await connect(need().platformUrl);
    try {
      // The channel is set once, by the migration job (app_owner), never by the platform role.
      await expectPgError(
        platform.query(`SELECT catalog.set_database_channel('production', 'x')`),
        '42501',
      );
    } finally {
      await platform.end();
    }
    const owner = await connect(need().ownerUrl);
    try {
      await expectPgError(
        owner.query(`SELECT catalog.set_database_channel('production', 'x')`),
        '23514',
      );
      const same = await owner.query(
        `SELECT catalog.set_database_channel('non_production', 'x') AS c`,
      );
      expect(same.rows[0].c).toBe('non_production');
    } finally {
      await owner.end();
    }
  });

  it('refuses to publish a draft into a production-marked database (function, channel guard, and table constraint)', async () => {
    const version = await nextCatalogVersion(w.admin);
    const drafts = fxBundles(version, [{ ...FX_CAT_ENTRIES.license, status: 'draft' }]);
    // A production-channel bundle that (wrongly) carries a draft: built by hand, since the
    // compiler never puts one there.
    const forged = { ...drafts.nonProduction, channel: 'production' as const };
    const admin = w.admin;
    // The profile is immutable, so mark production on a fresh database instead of the shared one.
    const scratch = `dh_prod_${Math.random().toString(16).slice(2, 10)}`;
    await admin.query(`CREATE DATABASE ${scratch}`);
    const url = new URL(need().adminUrl);
    url.pathname = `/${scratch}`;
    try {
      await migrate({ connectionString: url.toString(), catalogChannel: 'production' });
      const prod = createDatabase({
        connectionString: url.toString(),
        assumeRole: 'app_platform',
        max: 1,
      });
      const ownerDb = await connect(url.toString());
      try {
        // 1. The TypeScript job refuses before calling the database, and any edit to a
        //    built bundle (here its changeset) breaks the content hash (S13).
        expect(() => verifyBundle(forged, 'production')).toThrow(ReadinessError);
        expect(() =>
          verifyBundle({ ...drafts.nonProduction, changeset: [] }, 'non_production'),
        ).toThrow(ReadinessError);
        // 2. The SQL function refuses the draft entry by name.
        const refused = await pgError(
          prod.withPlatform(SYSTEM, (tx) =>
            tx.execute(
              sql`SELECT catalog.publish_release(${JSON.stringify(forged)}::jsonb, 'test')`,
            ),
          ),
        );
        expect(refused).toMatchObject({ code: '23514' });
        expect(refused.message).toMatch(/non-verified catalog entry TEST-05-LICENSE/);
        // 3. A non-production bundle cannot be loaded into a production database at all.
        await expect(
          runCatalogPublishJob({
            platform: prod,
            bundles: { non_production: drafts.nonProduction },
          }),
        ).rejects.toMatchObject({ code: 'bundle_channel_mismatch' });
        // 4. The table constraint rejects a draft row even from the owner, bypassing the function.
        await ownerDb.query('BEGIN');
        await ownerDb.query('SET LOCAL ROLE app_owner');
        const rel = await ownerDb.query(
          `INSERT INTO catalog.catalog_release (catalog_version, channel, bundle_format, content_hash, source_register_hash,
                                                entry_count, sources, changeset, published_by)
           VALUES ('9.9.9', 'production', 1, repeat('a', 64), repeat('b', 64), 1, '[]', '[]', 'constraint test')
           RETURNING id`,
        );
        await ownerDb.query(
          `INSERT INTO catalog.requirement (id, jurisdiction, first_release_id) VALUES ('TEST-05-LICENSE', 'federal', $1)`,
          [rel.rows[0].id],
        );
        // Outside a publish, nothing can be added to a release (S9).
        await expectPgError(
          attempt(ownerDb, () =>
            ownerDb.query(
              `INSERT INTO catalog.requirement_version (catalog_release_id, channel, requirement_id, status, entry_hash,
                 chapter, layer, jurisdiction, severity, title, effective_from, entry)
               VALUES ($1, 'production', 'TEST-05-LICENSE', 'verified', repeat('c', 64), 5, 'requirement', 'federal',
                       'high', 'Synthetic', DATE '2020-01-01', '{"status":"verified"}')`,
              [rel.rows[0].id],
            ),
          ),
          '42501',
        );
        // Even inside one, the stored entry must agree with the status column.
        await ownerDb.query(`SELECT set_config('catalog.publishing_release', $1, true)`, [
          rel.rows[0].id,
        ]);
        await expectPgError(
          attempt(ownerDb, () =>
            ownerDb.query(
              `INSERT INTO catalog.requirement_version (catalog_release_id, channel, requirement_id, status, entry_hash,
                 chapter, layer, jurisdiction, severity, title, effective_from, entry)
               VALUES ($1, 'production', 'TEST-05-LICENSE', 'verified', repeat('c', 64), 5, 'requirement', 'federal',
                       'high', 'Synthetic', DATE '2020-01-01', '{"status":"draft"}')`,
              [rel.rows[0].id],
            ),
          ),
          '23514',
        );
        const msg = await expectPgError(
          attempt(ownerDb, () =>
            ownerDb.query(
              `INSERT INTO catalog.requirement_version (catalog_release_id, channel, requirement_id, status, entry_hash,
                 chapter, layer, jurisdiction, severity, title, effective_from, entry)
               VALUES ($1, 'production', 'TEST-05-LICENSE', 'draft', repeat('c', 64), 5, 'requirement', 'federal',
                       'high', 'Synthetic', DATE '2020-01-01', '{"status":"draft"}')`,
              [rel.rows[0].id],
            ),
          ),
          '23514',
        );
        expect(msg).toMatch(/requirement_version_production_verified/);
        // Nor can a release claim a channel other than the database's.
        await expectPgError(
          attempt(ownerDb, () =>
            ownerDb.query(
              `INSERT INTO catalog.catalog_release (catalog_version, channel, bundle_format, content_hash, source_register_hash,
                                                    entry_count, sources, changeset, published_by)
               VALUES ('9.9.8', 'non_production', 1, repeat('a', 64), repeat('b', 64), 0, '[]', '[]', 'x')`,
            ),
          ),
          '23514',
        );
        await ownerDb.query('ROLLBACK');
        // 5. The real catalog today: every entry is a draft, so production gets an empty release.
        const real = compileCatalog(await loadCatalogSources(), { catalogVersion: '2026.1.0' });
        expect(real.productionEmpty).toBe(true);
        const empty = await runCatalogPublishJob({
          platform: prod,
          bundles: { production: real.production!, non_production: real.nonProduction! },
        });
        expect(empty).toMatchObject({ channel: 'production', entryCount: 0, created: true });
      } finally {
        await ownerDb.end();
        await prod.close();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    }
  });
});
