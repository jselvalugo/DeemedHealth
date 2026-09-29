/**
 * Forward-only SQL migration runner.
 *
 * - Files: migrations/NNNN_name.sql, applied in order, each in its own transaction.
 * - Every file runs with SET LOCAL ROLE app_owner, so app_owner owns every object,
 *   except files whose header declares `-- dh:run-as admin` (only the bootstrap).
 * - Applied files are recorded with their SHA-256 in dh_migrations.applied. Editing an
 *   applied file, or deleting one, stops the run: fixes are new migrations.
 * - A session advisory lock keeps two deploys from migrating at once.
 *
 * Connect with the migration (admin) credentials, never with a runtime role.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const RUN_AS_ADMIN = /^--\s*dh:run-as\s+admin\s*$/m;
const LOCK_KEY = 'dh_migrations';

export interface MigrationFile {
  name: string;
  sql: string;
  sha256: string;
  runAsAdmin: boolean;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    if (!FILE_PATTERN.test(name)) throw new MigrationError(`bad migration file name: ${name}`);
    const text = await readFile(join(dir, name), 'utf8');
    files.push({
      name,
      sql: text,
      sha256: createHash('sha256').update(text).digest('hex'),
      runAsAdmin: RUN_AS_ADMIN.test(text),
    });
  }
  return files;
}

export interface MigrateOptions {
  connectionString: string;
  dir?: string;
  log?: (message: string) => void;
  /**
   * Marks the database's catalog channel once, after the migrations (ADR-0003 rule 8):
   * production databases accept only verified entries. Omitted: left as is (a database
   * with no channel refuses every catalog publish).
   */
  catalogChannel?: CatalogChannel;
}

export type CatalogChannel = 'production' | 'non_production';

/**
 * The explicit `--catalog-channel` value, checked against DH_ENV (S4): production goes
 * with production only, every other environment with non_production. No flag: undefined
 * (the channel is left as it is; a database with none refuses every catalog publish).
 */
export function resolveCatalogChannel(
  flag: string | undefined,
  dhEnv: string | undefined,
): CatalogChannel | undefined {
  if (flag === undefined) return undefined;
  if (flag !== 'production' && flag !== 'non_production') {
    throw new MigrationError('--catalog-channel must be production or non_production');
  }
  if (!dhEnv) throw new MigrationError('--catalog-channel needs DH_ENV to agree with');
  const expected: CatalogChannel = dhEnv === 'production' ? 'production' : 'non_production';
  if (flag !== expected) {
    throw new MigrationError(`--catalog-channel ${flag} does not agree with DH_ENV ${dhEnv}`);
  }
  return flag;
}

export async function migrate(options: MigrateOptions): Promise<{ applied: string[] }> {
  const log = options.log ?? (() => undefined);
  const files = await loadMigrations(options.dir);
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS dh_migrations;
      REVOKE ALL ON SCHEMA dh_migrations FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS dh_migrations.applied (
        name        text        PRIMARY KEY,
        sha256      text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );`);
    const done = new Map(
      (
        await client.query<{ name: string; sha256: string }>(
          'SELECT name, sha256 FROM dh_migrations.applied',
        )
      ).rows.map((r) => [r.name, r.sha256]),
    );
    const known = new Set(files.map((f) => f.name));
    for (const name of done.keys()) {
      if (!known.has(name))
        throw new MigrationError(
          `applied migration ${name} is missing from ${options.dir ?? MIGRATIONS_DIR}`,
        );
    }
    for (const file of files) {
      const previous = done.get(file.name);
      if (previous !== undefined) {
        if (previous !== file.sha256) {
          throw new MigrationError(
            `migration ${file.name} changed after it was applied; migrations are forward-only, add a new one`,
          );
        }
        continue;
      }
      log(`applying ${file.name}${file.runAsAdmin ? ' (as admin)' : ''}`);
      await client.query('BEGIN');
      try {
        if (!file.runAsAdmin) await client.query('SET LOCAL ROLE app_owner');
        await client.query(file.sql);
        await client.query('RESET ROLE');
        await client.query('INSERT INTO dh_migrations.applied (name, sha256) VALUES ($1, $2)', [
          file.name,
          file.sha256,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(`migration ${file.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      applied.push(file.name);
    }
    if (options.catalogChannel !== undefined) {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE app_owner');
        await client.query(`SELECT catalog.set_database_channel($1, 'migration job')`, [
          options.catalogChannel,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(`could not set the catalog channel: ${(error as Error).message}`, {
          cause: error,
        });
      }
      log(`catalog channel: ${options.catalogChannel}`);
    }
    return { applied };
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
      .catch(() => undefined);
    await client.end();
  }
}
