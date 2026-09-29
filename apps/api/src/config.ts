/**
 * API configuration from the environment, validated once at startup (ADR-0013 section 3).
 * Fails closed and reports variable NAMES only, never values.
 *
 * INTERIM: @deemed/config/env (slice S0b) will own this schema; entry points pass
 * process.env in so nothing else here reads it.
 *
 *   DH_DEV_ROOT_KEY   canonical base64 of exactly 32 random bytes (non-production):
 *                     generate with `openssl rand -base64 32`
 *   DH_TRUST_PROXY    optional comma-separated proxy CIDRs allowed to set
 *                     X-Forwarded-For (on AWS: the ALB subnets). Unset: none.
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
  /** Proxy CIDRs trusted for X-Forwarded-For; empty = trust no proxy. */
  trustProxy: string[];
}

/** True for canonical base64 of exactly 32 bytes (what `openssl rand -base64 32` prints). */
export function isCanonicalKey32(value: string): boolean {
  if (value.length !== 44) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value;
}

/** A CIDR or address, checked with a loop (digits, hex, '.', ':', '/'). */
function isProxyEntry(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const ok =
      (c >= 48 && c <= 58) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70) || c === 46 || c === 47;
    if (!ok) return false;
  }
  return true;
}

const Env = z.object({
  DH_ENV: z.enum(DH_ENVS),
  DATABASE_URL: z.string().min(1),
  DH_PUBLIC_ORIGIN: z.string().url(),
  DH_DEV_ROOT_KEY: z.string().min(1).optional(),
  DH_INSECURE_COOKIES: z.enum(['0', '1']).optional(),
  DH_TRUST_PROXY: z.string().optional(),
});

/**
 * Variables that only a deployed host sets (Netlify builds and functions, AWS Lambda,
 * ECS tasks). `DH_ENV=local` is refused when any is present, so behaviour that is on only
 * locally (the `records.import` flag, insecure cookies) can never switch on in a
 * deployed environment (security review L6).
 */
export const DEPLOYED_MARKERS = [
  'NETLIFY',
  'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_FUNCTION_NAME',
  'ECS_CONTAINER_METADATA_URI',
  'ECS_CONTAINER_METADATA_URI_V4',
] as const;

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
  if (e.DH_ENV === 'local') {
    const present = DEPLOYED_MARKERS.filter((name) => (env[name] ?? '') !== '');
    if (present.length > 0) {
      throw new ConfigError(
        `DH_ENV=local is refused on a deployed host (${present.join(', ')} set)`,
        ['DH_ENV', ...present],
      );
    }
  }
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
  if (!isCanonicalKey32(e.DH_DEV_ROOT_KEY)) {
    throw new ConfigError(
      'invalid configuration: DH_DEV_ROOT_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)',
      ['DH_DEV_ROOT_KEY'],
    );
  }
  const root = Buffer.from(e.DH_DEV_ROOT_KEY, 'base64');
  const trustProxy = (e.DH_TRUST_PROXY ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (!trustProxy.every(isProxyEntry)) {
    throw new ConfigError('invalid configuration: DH_TRUST_PROXY', ['DH_TRUST_PROXY']);
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
    trustProxy,
  };
}
