/**
 * Which sign-in backend the web app uses (phase-1 plan S3, frontend task):
 *
 *   api   the real apps/api sessions, MFA, and RBAC. Every environment with a
 *         database, and always in development, staging, and production.
 *   stub  the synthetic S1 demo (auth-stub.ts), ONLY for DH_ENV local or preview
 *         when no DATABASE_URL is configured, so the shell can still be reviewed.
 */
export type AuthMode = 'api' | 'stub';

export function authMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthMode {
  const stubAllowed = env['DH_ENV'] === 'local' || env['DH_ENV'] === 'preview';
  return stubAllowed && !env['DATABASE_URL'] ? 'stub' : 'api';
}
