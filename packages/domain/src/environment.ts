export const DH_ENVS = ['local', 'preview', 'staging', 'production'] as const;
export type DhEnv = (typeof DH_ENVS)[number];

/** Anything other than the exact string "production" is non-production (ADR-0005 §5). */
export function isProduction(value: string | undefined): boolean {
  return value === 'production';
}

/** Parse DH_ENV; throws on a missing or invalid value so the app fails to start. */
export function parseDhEnv(value: string | undefined): DhEnv {
  if (value && (DH_ENVS as readonly string[]).includes(value)) return value as DhEnv;
  throw new Error(`DH_ENV must be one of ${DH_ENVS.join(', ')}`);
}
