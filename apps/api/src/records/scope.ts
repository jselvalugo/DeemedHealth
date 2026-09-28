/**
 * The record policy in memory (ADR-0014 section 5, layers 3 to 5), for `get`, every
 * mutation, and a second check on every listed row. Layer 1 (tenant) is RLS; layer 6
 * (fields) is the serializer in rows.ts.
 *
 * A record linked to several sites is visible when ANY of its sites is in scope, and
 * may be changed only when ALL of them are (fail closed for writes). A record with no
 * site is organization-wide: only an organization-wide grant covers it.
 *
 * A record outside the viewer's read scope answers 404, not 403, so its existence does
 * not leak; the refusal is still audited. A visible record with a forbidden action
 * answers 403.
 */
import {
  bareTable,
  getRole,
  type Decision,
  type Permission,
  type RecordTypeDef,
  type RoleId,
} from '@deemed/domain';
import type { Helpers } from '../context.js';
import { DeniedError, type DenialTarget } from '../errors.js';
import type { Row } from './rows.js';

export interface RecordResource {
  sites: readonly string[];
  owners: readonly string[];
}

export function resourceOf(row: Row): RecordResource {
  return { sites: row.__sites ?? [], owners: row.__owners ?? [] };
}

/**
 * The sites and owners of a record not written yet (create, import): its site column's
 * value, or none (organization-level: only an organization-wide grant may create it).
 */
export function newResource(
  def: RecordTypeDef,
  values: Readonly<Record<string, unknown>>,
): RecordResource {
  const scope = def.siteScope;
  const siteField =
    typeof scope === 'object' && 'column' in scope
      ? Object.entries(def.fields).find(([, f]) => f.column === scope.column)?.[0]
      : undefined;
  const site = siteField ? values[siteField] : undefined;
  const owner = def.owner ? values[def.owner.field] : undefined;
  return {
    sites: typeof site === 'string' ? [site] : [],
    owners: typeof owner === 'string' ? [owner] : [],
  };
}

export function decideRecord(
  h: Helpers,
  permission: Permission,
  rec: RecordResource,
  mode: 'any' | 'all',
  onlyRoles?: readonly RoleId[],
): Decision {
  const options = onlyRoles ? { onlyRoles } : undefined;
  if (rec.sites.length === 0) {
    return h.decide(permission, { siteId: null, ownerPersonIds: rec.owners }, options);
  }
  let denied: Decision | null = null;
  const grants = new Set<string>();
  for (const siteId of rec.sites) {
    const d = h.decide(permission, { siteId, ownerPersonIds: rec.owners }, options);
    if (d.allowed) {
      if (mode === 'any') return d;
      d.grantIds.forEach((g) => grants.add(g));
    } else {
      if (mode === 'all') return d;
      denied ??= d;
    }
  }
  return mode === 'all' ? { allowed: true, grantIds: [...grants] } : (denied as Decision);
}

export function targetOf(def: RecordTypeDef, row: Row): DenialTarget {
  return {
    table: bareTable(def.table),
    id: row.__id,
    siteId: row.__sites.length === 1 ? (row.__sites[0] as string) : null,
  };
}

/** Read access to the record, or a hidden (404) audited denial. */
export function requireVisible(h: Helpers, def: RecordTypeDef, row: Row): Decision {
  const d = decideRecord(h, def.access.read, resourceOf(row), 'any');
  if (!d.allowed) throw new DeniedError(d.reason, targetOf(def, row), true);
  h.markRecordChecked();
  return d;
}

/** A change to a visible record: every one of its sites must allow it (403 otherwise). */
export function requireAction(
  h: Helpers,
  def: RecordTypeDef,
  row: Row,
  permission: Permission,
): void {
  const d = decideRecord(h, permission, resourceOf(row), 'all');
  if (!d.allowed) throw new DeniedError(d.reason, targetOf(def, row));
  h.markRecordChecked();
}

/**
 * `auditor_scope` (ADR-0014 section 2.6): the auditor role sees record history only under
 * the `audit_log_read` expansion, which is not accepted yet, so a read that only an
 * auditor grant allows does not open history (fail closed).
 */
export function onlyAuditorGrants(h: Helpers, decision: Decision): boolean {
  if (!decision.allowed) return false;
  const grants = h.principal().grants;
  return decision.grantIds.every((id) => {
    const g = grants.find((x) => x.id === id);
    return g !== undefined && getRole(g.roleId as RoleId).auditsEveryView;
  });
}

export function historyAllowed(h: Helpers, def: RecordTypeDef, decision: Decision): boolean {
  return !(def.access.recordRules.includes('auditor_scope') && onlyAuditorGrants(h, decision));
}
