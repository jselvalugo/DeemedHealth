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
import type { AuditEventInput, Tx } from '@deemed/db';
import {
  AUDIT_ACTIONS,
  DENIABLE_CATEGORIES,
  type AuditAction,
  type JsonValue,
} from '@deemed/domain';
import { sql } from 'drizzle-orm';
import type { DenialTarget, DeniedError } from './errors.js';
import type { RouteId, RouteSpec } from './manifest.js';

// The diff builder lives in @deemed/db so domain services that write their own events
// (readiness) redact the same way.
export { redactedDiff, type TextDigest } from '@deemed/db';

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
    // Reveal events always carry a reason (ADR-0008 section 4); a refusal gets a fixed one,
    // never the caller's text.
    const reason = ownCategory === 'reveal' ? { reason: `refused: ${error.reason}` } : {};
    return { category: ownCategory, action: own, ...common, ...reason };
  }
  return { category: 'auth', action: 'access.denied', ...common };
}
