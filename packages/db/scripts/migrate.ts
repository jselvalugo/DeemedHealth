/**
 * CLI: pnpm --filter @deemed/db migrate
 * Env: DATABASE_URL with the migration (admin) credentials. Never a runtime role.
 */
import { parseArgs } from 'node:util';
import { migrate, resolveCatalogChannel } from '../src/migrate.js';

const connectionString = process.env.DATABASE_URL;
// --catalog-channel production|non_production marks the database's catalog channel (it
// must agree with DH_ENV). Without it the channel is left as is (fail closed: a database
// with no channel refuses every catalog publish).
const { values } = parseArgs({ options: { 'catalog-channel': { type: 'string' } } });
try {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const catalogChannel = resolveCatalogChannel(values['catalog-channel'], process.env.DH_ENV);
  const { applied } = await migrate({
    connectionString,
    log: (m) => console.log(m),
    ...(catalogChannel ? { catalogChannel } : {}),
  });
  console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
