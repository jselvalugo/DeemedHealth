/**
 * Vitest global setup for the @deemed/db integration tests.
 *
 * Gets a PostgreSQL 16 server (see pg-harness.ts), creates a scratch database, applies
 * every migration with the admin credentials, gives the runtime roles test-only
 * passwords so the tests log in AS those roles, and seeds two synthetic tenants.
 *
 * No server available: locally the DB tests are skipped with a clear banner. In CI
 * (CI=true) or with DH_REQUIRE_DB=1 that is a hard failure, so CI can never pass by
 * silently skipping.
 */
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import type { GlobalSetupContext } from 'vitest/node';
import { migrate } from '../src/migrate.js';
import { GULF_FIXTURE, XYZ_FIXTURE } from '../seed/fixtures.js';
import { runSeed } from '../seed/seed.js';
import { seedAuthIsolationRows } from './auth-fixtures.js';
import './context.js';
import { acquirePostgres, withDatabase } from './pg-harness.js';

const log = (m: string) => console.log(`[db-tests] ${m}`);

export default async function setup({ provide }: GlobalSetupContext) {
  const required = process.env.CI === 'true' || process.env.DH_REQUIRE_DB === '1';
  const acquired = await acquirePostgres(log);

  if ('skipReason' in acquired) {
    const message = `PostgreSQL integration tests SKIPPED: no PostgreSQL 16 available (${acquired.skipReason}). Set DATABASE_URL or install postgresql-16 to run them.`;
    if (required) throw new Error(`${message} This is fatal because CI=true or DH_REQUIRE_DB=1.`);
    console.warn(`\n${'='.repeat(78)}\n[db-tests] ${message}\n${'='.repeat(78)}\n`);
    provide('db', { available: false, skipReason: acquired.skipReason });
    return;
  }

  const dbName = `dh_test_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: acquired.adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const adminUrl = withDatabase(acquired.adminUrl, dbName);
  try {
    const { applied } = await migrate({ connectionString: adminUrl });
    log(`database ${dbName} (${acquired.source}): applied ${applied.join(', ')}`);

    // Test-only login credentials for the runtime roles. Roles are cluster-wide; in CI
    // and in the throwaway cluster nothing else uses them.
    const password = randomBytes(18).toString('base64url');
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    for (const role of ['app_user', 'app_platform', 'app_owner']) {
      await client.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    }
    await client.end();

    // Synthetic persona password for the sign-in tests (non-production seed option).
    const personaPassword = `persona-${randomBytes(9).toString('base64url')}`;
    const [xyz, gulf] = await runSeed({
      connectionString: adminUrl,
      dhEnv: 'local',
      fixtures: [XYZ_FIXTURE, GULF_FIXTURE],
      personaPasswordHash: await hash(personaPassword),
    });
    if (!xyz || !gulf) throw new Error('seed returned no tenants');
    await seedAuthIsolationRows(adminUrl, [
      { organizationId: xyz.organizationId, userAccountId: xyz.userIds.provider1 as string },
      { organizationId: gulf.organizationId, userAccountId: gulf.userIds.provider1 as string },
    ]);

    provide('db', {
      available: true,
      source: acquired.source,
      adminUrl,
      appUserUrl: withDatabase(acquired.adminUrl, dbName, { name: 'app_user', password }),
      platformUrl: withDatabase(acquired.adminUrl, dbName, { name: 'app_platform', password }),
      ownerUrl: withDatabase(acquired.adminUrl, dbName, { name: 'app_owner', password }),
      personaPassword,
      tenants: {
        xyz: {
          organizationId: xyz.organizationId,
          userIds: xyz.userIds,
          personIds: xyz.personIds,
          siteIds: xyz.siteIds,
        },
        gulf: {
          organizationId: gulf.organizationId,
          userIds: gulf.userIds,
          personIds: gulf.personIds,
          siteIds: gulf.siteIds,
        },
      },
    });
  } catch (error) {
    await teardown(acquired.adminUrl, dbName, acquired.stop);
    throw error;
  }

  return () => teardown(acquired.adminUrl, dbName, acquired.stop);
}

async function teardown(serverUrl: string, dbName: string, stop: () => Promise<void>) {
  const admin = new pg.Client({ connectionString: serverUrl });
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } catch (error) {
    console.warn(`[db-tests] could not drop ${dbName}: ${(error as Error).message}`);
  } finally {
    await admin.end().catch(() => undefined);
    await stop();
  }
}
