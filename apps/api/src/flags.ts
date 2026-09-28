/**
 * Feature flags the API reads (ADR-0013 section 4).
 *
 * INTERIM: the flag definitions, `platform.feature_flag`, and tenant values arrive with
 * S0b (`packages/config/flags.ts`). Until then this file holds the definition defaults
 * per DH_ENV and nothing can turn a flag on outside them. Evaluation is deny by
 * default: an unknown flag or an unknown DH_ENV is off.
 */
import { DH_ENVS, type DhEnv } from '@deemed/domain';

interface FlagDefinition {
  kind: 'release' | 'ops' | 'entitlement' | 'kill-switch';
  owner: string;
  defaults: Readonly<Record<DhEnv, boolean>>;
  /** Release flags only: when the flag must be gone. */
  removeBy?: string;
  description: string;
}

export const FLAGS = {
  /**
   * Record import (ADR-0014 section 2.8). Off in every deployed environment until gate G4,
   * so nobody can load real data (D9); only local runs and CI (synthetic fixtures) have it.
   */
  'records.import': {
    kind: 'release',
    owner: 'backend-engineer',
    defaults: {
      local: true,
      preview: false,
      development: false,
      staging: false,
      production: false,
    },
    removeBy: 'G4 (roadmap gate)',
    description: 'CSV import with dry run for record types that declare import',
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;

export function flagEnabled(key: string, dhEnv: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(FLAGS, key)) return false;
  if (!(DH_ENVS as readonly string[]).includes(dhEnv)) return false;
  return FLAGS[key as FlagKey].defaults[dhEnv as DhEnv];
}
