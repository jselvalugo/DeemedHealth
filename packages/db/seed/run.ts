/**
 * CLI: pnpm --filter @deemed/db seed
 * Env: DATABASE_URL (migration credentials), DH_ENV (must not be production).
 */
import { XYZ_FIXTURE } from './fixtures.js';
import { SeedRefusedError, runSeed } from './seed.js';

const connectionString = process.env.DATABASE_URL;

try {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const results = await runSeed({
    connectionString,
    dhEnv: process.env.DH_ENV,
    fixtures: [XYZ_FIXTURE],
  });
  for (const r of results) {
    console.log(`${r.created ? 'seeded' : 'already present'}: organization ${r.organizationId}`);
  }
} catch (error) {
  console.error(error instanceof SeedRefusedError ? error.message : error);
  process.exitCode = 1;
}
