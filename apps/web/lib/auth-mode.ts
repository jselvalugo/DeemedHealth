/**
 * Which sign-in backend the web app uses:
 *
 *   api   the real apps/api sessions, MFA, and RBAC, whenever DATABASE_URL is set,
 *         and always when DH_ENV is production (or missing or unknown).
 *   stub  the synthetic S1 demo (auth-stub.ts) in any NON-production environment
 *         without a database, so a site with no database yet (the development site
 *         while Netlify DB is pending) keeps working.
 */
import { DH_ENVS, isProduction } from '@deemed/domain';

export type AuthMode = 'api' | 'stub';

export function authMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthMode {
  const dhEnv = env['DH_ENV'];
  const known = dhEnv !== undefined && (DH_ENVS as readonly string[]).includes(dhEnv);
  if (!known || isProduction(dhEnv)) return 'api';
  return env['DATABASE_URL'] ? 'api' : 'stub';
}
