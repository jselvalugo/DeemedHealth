/**
 * CLI: pnpm --filter @deemed/db seed
 * Env: DATABASE_URL (migration credentials), DH_ENV (must not be production).
 * Optional: DH_SEED_PERSONA_PASSWORD, the shared password of the synthetic personas
 * (kept in the team password manager, at least 12 characters). Personas enroll their
 * own passkey or TOTP at first sign-in; no MFA secret is ever seeded.
 */
import { hash } from '@node-rs/argon2';
import { XYZ_FIXTURE } from './fixtures.js';
import { SeedRefusedError, runSeed } from './seed.js';

const connectionString = process.env.DATABASE_URL;
const personaPassword = process.env.DH_SEED_PERSONA_PASSWORD;

try {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (personaPassword !== undefined && personaPassword.length < 12) {
    throw new Error('DH_SEED_PERSONA_PASSWORD must be at least 12 characters');
  }
  const personaPasswordHash =
    personaPassword === undefined
      ? undefined
      : await hash(personaPassword, { algorithm: 2, memoryCost: 19_456, timeCost: 2 });
  const results = await runSeed({
    connectionString,
    dhEnv: process.env.DH_ENV,
    fixtures: [XYZ_FIXTURE],
    ...(personaPasswordHash === undefined ? {} : { personaPasswordHash }),
  });
  for (const r of results) {
    console.log(`${r.created ? 'seeded' : 'already present'}: organization ${r.organizationId}`);
  }
} catch (error) {
  console.error(error instanceof SeedRefusedError ? error.message : error);
  process.exitCode = 1;
}
