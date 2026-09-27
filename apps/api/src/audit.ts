/**
 * Audit middleware helpers (ADR-0008 sections 4 and 5).
 *
 *  - `redactedDiff` builds the before/after of changed columns only, redacted by the
 *    sensitivity class in the data dictionary (the column registry): PII/PHI and
 *    field-encrypted values never enter the log, and a column missing from the
 *    registry is an error, not a silent pass-through.
 *  - `chainSeq` lets the request transaction prove that a mutation wrote an event.
 *  - `deniedEvent` shapes the event for a refused request (outcome = denied).
 */
import { DATA_DICTIONARY, type AuditEventInput, type Tx } from '@deemed/db';
import {
  AUDIT_ACTIONS,
  DENIABLE_CATEGORIES,
  type AuditAction,
  type JsonValue,
} from '@deemed/domain';
import { sql } from 'drizzle-orm';
import type { DenialTarget, DeniedError } from './errors.js';
import type { RouteId, RouteSpec } from './manifest.js';

type Row = Record<string, JsonValue | Date | undefined>;

function plain(value: JsonValue | Date | undefined): JsonValue {
  if (value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** `{ fields: { column: { before, after } } }` for changed columns, redacted by class. */
export function redactedDiff(table: string, before: Row | null, after: Row | null): JsonValue {
  const entry = DATA_DICTIONARY[table];
  if (!entry) throw new Error(`audit diff: ${table} is not in the data dictionary`);
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const fields: Record<string, JsonValue> = {};
  for (const column of columns) {
    const spec = entry.columns[column];
    if (!spec) throw new Error(`audit diff: ${table}.${column} has no sensitivity class`);
    const b = plain(before?.[column]);
    const a = plain(after?.[column]);
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    if (spec.encryption || spec.class === 'PII' || spec.class === 'PHI') {
      fields[column] = { changed: true, redacted: true };
    } else {
      fields[column] = { before: b, after: a };
    }
  }
  return { fields };
}

export async function chainSeq(tx: Tx, organizationId: string): Promise<number> {
  const r = await tx.execute<{ seq: string | null }>(
    sql`SELECT max(chain_seq)::text AS seq FROM audit.chain_head WHERE organization_id = ${organizationId}::uuid`,
  );
  return Number(r.rows[0]?.seq ?? 0);
}

/**
 * The event for a denied request. It uses the route's own action when that action's
 * category logs denials and a target is known (e.g. `role.grant`, outcome denied);
 * otherwise `access.denied` (category auth).
 */
export function deniedEvent(
  routeId: RouteId | null,
  spec: RouteSpec | undefined,
  error: DeniedError,
  meta: { ip: string; userAgent: string; sessionId: string },
): AuditEventInput {
  const metadata: Record<string, JsonValue> = {
    route: routeId ?? 'unknown',
    reason: error.reason,
  };
  if (spec?.access.kind === 'permission') metadata.permission = spec.access.permission;
  const target: DenialTarget | undefined = error.target;
  const own = spec?.audit && spec.audit.by !== 'auth' ? (spec.audit.action as AuditAction) : null;
  const ownCategory = own ? AUDIT_ACTIONS[own].category : null;
  const common = {
    outcome: 'denied' as const,
    ipAddress: meta.ip,
    userAgent: meta.userAgent || 'unknown',
    sessionId: meta.sessionId,
    metadata,
    ...(target ? { targetTable: target.table, targetId: target.id } : {}),
    ...(target?.siteId ? { siteId: target.siteId } : {}),
  };
  if (own && ownCategory && target && DENIABLE_CATEGORIES.includes(ownCategory)) {
    return { category: ownCategory, action: own, ...common };
  }
  return { category: 'auth', action: 'access.denied', ...common };
}
