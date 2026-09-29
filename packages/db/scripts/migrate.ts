/**
 * CLI: pnpm --filter @deemed/db migrate
 * Env: DATABASE_URL with the migration (admin) credentials. Never a runtime role.
 */
import { parseDhEnv } from '@deemed/domain';
import { migrate } from '../src/migrate.js';

const connectionString = process.env.DATABASE_URL;
// DH_ENV marks the catalog channel once (production accepts verified entries only).
// Without DH_ENV the channel is left unset, and catalog publishing refuses (fail closed).
const dhEnv = process.env.DH_ENV;
try {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const { applied } = await migrate({
    connectionString,
    log: (m) => console.log(m),
    ...(dhEnv
      ? { catalogChannel: parseDhEnv(dhEnv) === 'production' ? 'production' : 'non_production' }
      : {}),
  });
  console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
