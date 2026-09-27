/**
 * API configuration from the environment, validated once at startup (ADR-0013 section 3).
 * Fails closed and reports variable NAMES only, never values.
 *
 * INTERIM: @deemed/config/env (slice S0b) will own this schema; entry points pass
 * process.env in so nothing else here reads it.
 */
import { DH_ENVS, isProduction, type DhEnv } from '@deemed/domain';
import { z } from 'zod';

export interface ApiConfig {
  dhEnv: DhEnv;
  databaseUrl: string;
  /** Exact origins allowed to send mutating requests (Origin header check). */
  allowedOrigins: string[];
  /** Secure cookies with the __Host- prefix. Off only for http://localhost development. */
  secureCookies: boolean;
  secretRootKey: Buffer;
  webauthn: { rpId: string; rpName: string; origins: string[] };
}

const Env = z.object({
  DH_ENV: z.enum(DH_ENVS),
  DATABASE_URL: z.string().min(1),
  DH_PUBLIC_ORIGIN: z.string().url(),
  DH_DEV_ROOT_KEY: z.string().min(1).optional(),
  DH_INSECURE_COOKIES: z.enum(['0', '1']).optional(),
});

export class ConfigError extends Error {
  override name = 'ConfigError';

  /** Names of the variables at fault (never their values). */
  constructor(
    message: string,
    readonly names: readonly string[] = [],
  ) {
    super(message);
  }
}

export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].sort();
    throw new ConfigError(`invalid or missing configuration: ${names.join(', ')}`, names);
  }
  const e = parsed.data;
  if (isProduction(e.DH_ENV)) {
    // Production keys come from KMS (ADR-0007) once packages/crypto exists (S6); the
    // development root key is refused there, so production cannot start yet.
    throw new ConfigError(
      'DH_ENV=production requires the KMS key provider (S6); DH_DEV_ROOT_KEY is refused',
    );
  }
  if (!e.DH_DEV_ROOT_KEY) {
    throw new ConfigError('invalid or missing configuration: DH_DEV_ROOT_KEY', ['DH_DEV_ROOT_KEY']);
  }
  const root = Buffer.from(e.DH_DEV_ROOT_KEY, 'base64');
  if (root.length < 32) {
    throw new ConfigError('invalid or missing configuration: DH_DEV_ROOT_KEY (32+ bytes, base64)', [
      'DH_DEV_ROOT_KEY',
    ]);
  }
  const origin = new URL(e.DH_PUBLIC_ORIGIN);
  const insecure = e.DH_INSECURE_COOKIES === '1';
  if (insecure && e.DH_ENV !== 'local') {
    throw new ConfigError('DH_INSECURE_COOKIES is allowed only when DH_ENV=local');
  }
  return {
    dhEnv: e.DH_ENV,
    databaseUrl: e.DATABASE_URL,
    allowedOrigins: [origin.origin],
    secureCookies: !insecure,
    secretRootKey: root,
    webauthn: { rpId: origin.hostname, rpName: 'Deemed Health', origins: [origin.origin] },
  };
}
