/**
 * Reads an entry's rule shape from the catalog conventions (requirements-catalog
 * src/conventions.ts); the engine never invents its own encoding.
 */
import {
  CadenceTrigger,
  KnownParameters,
  checkTenantParameterValue,
  type ApprovalBacking,
  type CatalogEntry,
  type TenantParameterSpec,
} from '@deemed/requirements-catalog';
import type { ApprovalCapacity, RuleShape } from './types.js';

export interface ResolvedRule {
  shape: RuleShape;
  approval: ApprovalBacking | null;
  /** A fixed interval, or the tenant parameter that drives it (periodic only). */
  interval: { months: number } | { parameter: string; spec: TenantParameterSpec } | null;
}

/** null when the entry cannot be evaluated (the compiler rejects such entries). */
export function resolveRule(entry: CatalogEntry): ResolvedRule | null {
  const params = KnownParameters.safeParse(entry.parameters);
  if (!params.success) return null;
  const approval = params.data.approval ?? null;
  const c = entry.cadence;
  if (c === null) return { shape: { kind: 'one_time' }, approval, interval: null };
  const trigger = CadenceTrigger.safeParse(c.trigger);
  if (!trigger.success) return null;
  const leadDays = [...new Set(c.leadDays)].sort((a, b) => b - a);
  switch (trigger.data) {
    case 'on_change':
      return { shape: { kind: 'on_change' }, approval, interval: null };
    case 'on_expiration':
    case 'on_hire_and_expiration':
      return { shape: { kind: 'expiration', leadDays }, approval, interval: null };
    case 'periodic': {
      const basis = params.data.cadenceBasis;
      if (!basis) return null;
      const driving = Object.entries(params.data.tenantParameters ?? {}).filter(
        ([, p]) => p.drives === 'cadence.renewalMonths',
      );
      let interval: ResolvedRule['interval'];
      if (c.renewalMonths !== null && driving.length === 0) interval = { months: c.renewalMonths };
      else if (c.renewalMonths === null && driving.length === 1) {
        const [parameter, spec] = driving[0] as [string, TenantParameterSpec];
        interval = { parameter, spec };
      } else return null;
      return { shape: { kind: 'periodic', basis, leadDays }, approval, interval };
    }
  }
}

export type IntervalResolution =
  | { ok: true; months: number; parameter: string | null }
  | {
      ok: false;
      code: 'tenant_parameter_unset' | 'tenant_parameter_out_of_bounds';
      parameter: string;
      spec: TenantParameterSpec;
      value: number | null;
    };

/** The interval in months: fixed, the tenant's value, or the catalog default. Fails closed. */
export function resolveInterval(
  interval: NonNullable<ResolvedRule['interval']>,
  tenantParameters: Readonly<Record<string, number>>,
): IntervalResolution {
  if ('months' in interval) return { ok: true, months: interval.months, parameter: null };
  const { parameter, spec } = interval;
  const chosen = Object.prototype.hasOwnProperty.call(tenantParameters, parameter)
    ? tenantParameters[parameter]
    : undefined;
  const value = chosen ?? spec.default;
  if (value === null || value === undefined) {
    return { ok: false, code: 'tenant_parameter_unset', parameter, spec, value: null };
  }
  if (checkTenantParameterValue(spec, value) !== null || value < 1) {
    return { ok: false, code: 'tenant_parameter_out_of_bounds', parameter, spec, value };
  }
  return { ok: true, months: value, parameter };
}

/** Capacities that satisfy each required capacity (approval-authority.md section 4.1). */
const SATISFIES: Readonly<
  Record<ApprovalBacking['requiredCapacity'], readonly ApprovalCapacity[]>
> = {
  board: ['board'],
  board_or_committee_ratified: ['board', 'committee_ratified'],
  designated: ['board', 'committee_ratified', 'designated'],
};

export function capacitySatisfies(
  required: ApprovalBacking['requiredCapacity'],
  actual: ApprovalCapacity,
): boolean {
  return SATISFIES[required].includes(actual);
}

/**
 * Approval type ids are dotted segments; a `*` segment in the catalog matches any one
 * segment (`cp.*` matches `cp.privileges`). Segment comparison only, no regex.
 */
export function approvalTypeMatches(pattern: string, actual: string): boolean {
  // A wildcard belongs to the catalog pattern only; a recorded type is always concrete.
  if (actual.length === 0 || actual.includes('*')) return false;
  const p = pattern.split('.');
  const a = actual.split('.');
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg === '*' || seg === a[i]);
}
