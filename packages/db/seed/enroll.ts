/**
 * CLI: pnpm --filter @deemed/db seed:enroll <persona login email>
 * Env: DATABASE_URL (migration credentials), DH_ENV (must not be production).
 * Prints a fresh single-use MFA enrollment code for a SYNTHETIC persona, so a reviewer
 * can enroll a passkey or authenticator. Production users get theirs out of band from
 * an administrator's MFA reset or an invitation, never from this tool.
 */
import { SeedRefusedError, issuePersonaEnrollmentToken } from './seed.js';

const connectionString = process.env.DATABASE_URL;
const email = process.argv[2];

try {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (!email) throw new Error('usage: seed:enroll <persona login email>');
  const token = await issuePersonaEnrollmentToken({
    connectionString,
    dhEnv: process.env.DH_ENV,
    email,
  });
  console.log(`enrollment code (single use, 7 days): ${token}`);
} catch (error) {
  console.error(error instanceof SeedRefusedError ? error.message : (error as Error).message);
  process.exitCode = 1;
}
