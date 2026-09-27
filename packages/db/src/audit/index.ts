/**
 * Audit log access (ADR-0008). Events are written only by the SQL function
 * audit.append_event, which assigns chain_seq, occurred_at, prev_hash, and row_hash,
 * takes actor_user_id and request_id from the transaction (app.actor_id,
 * app.request_id), and enforces the category rules. Use inside withTenant().
 */
import type { AuditRowExport, JsonValue } from '@deemed/domain';
import { sql } from 'drizzle-orm';
import type { TransactionContext, Tx } from '../client.js';
import type { AuditCategory, AuditOutcome } from '../schema/audit.js';

export interface AuditEventInput {
  category: AuditCategory;
  /** Registered `<entity>.<verb>` from audit.action_registry. */
  action: string;
  outcome?: AuditOutcome;
  targetTable?: string;
  targetId?: string;
  siteId?: string;
  requirementIds?: readonly string[];
  /** Required for reveal and system events (including genesis), overrides, break-glass. */
  reason?: string;
  /** Redacted before/after of changed fields only (ADR-0008 section 5). */
  diff?: JsonValue;
  metadata?: JsonValue;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

const json = (value: JsonValue | undefined) =>
  value === undefined ? sql`NULL::jsonb` : sql`${JSON.stringify(value)}::jsonb`;

// Drizzle expands a JS array into one parameter per element, so arrays travel as JSON.
const textArray = (values: readonly string[] | undefined) =>
  values === undefined
    ? sql`NULL::text[]`
    : sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;

/**
 * Appends one event to the tenant's hash chain, as the transaction's actor; returns
 * the event id. `context` is the second argument withTenant passes to its callback.
 */
export async function appendAuditEvent(
  tx: Tx,
  context: TransactionContext,
  event: AuditEventInput,
): Promise<string> {
  if (context.organizationId === null)
    throw new Error('appendAuditEvent needs a tenant transaction');
  const { actor } = context;
  const result = await tx.execute<{ id: string }>(sql`
    SELECT audit.append_event(
      p_organization_id => ${context.organizationId}::uuid,
      p_category        => ${event.category}::text,
      p_action          => ${event.action}::text,
      p_actor_type      => ${actor.type}::text,
      p_actor_label     => ${actor.label}::text,
      p_outcome         => ${event.outcome ?? 'success'}::text,
      p_actor_person_id => ${actor.personId ?? null}::uuid,
      p_on_behalf_of_id => ${actor.onBehalfOfId ?? null}::uuid,
      p_target_table    => ${event.targetTable ?? null}::text,
      p_target_id       => ${event.targetId ?? null}::uuid,
      p_site_id         => ${event.siteId ?? null}::uuid,
      p_requirement_ids => ${textArray(event.requirementIds)},
      p_reason          => ${event.reason ?? null}::text,
      p_diff            => ${json(event.diff)},
      p_metadata        => ${json(event.metadata ?? {})},
      p_ip_address      => ${event.ipAddress ?? null}::inet,
      p_user_agent      => ${event.userAgent ?? null}::text,
      p_session_id      => ${event.sessionId ?? null}::uuid
    )::text AS id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('audit.append_event returned no id');
  return id;
}

/**
 * SELECT list producing the export (text) form that the canonicalizer in
 * @deemed/domain hashes. Keep in step with audit.canonical_text().
 */
export const AUDIT_EXPORT_COLUMNS = `
  id::text AS id,
  organization_id::text AS organization_id,
  chain_seq,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  category, action, outcome, actor_type,
  actor_person_id::text AS actor_person_id,
  actor_user_id::text AS actor_user_id,
  actor_label,
  on_behalf_of_id::text AS on_behalf_of_id,
  session_id::text AS session_id,
  request_id::text AS request_id,
  abbrev(ip_address) AS ip_address,
  user_agent,
  site_id::text AS site_id,
  target_table,
  target_id::text AS target_id,
  requirement_ids, reason, diff, metadata, schema_version,
  encode(prev_hash, 'hex') AS prev_hash,
  encode(row_hash, 'hex') AS row_hash`;

export type RawAuditExportRow = Omit<AuditRowExport, 'chain_seq'> & { chain_seq: string | number };

/** Converts a driver row (bigint arrives as a string) to the export form. */
export function toAuditRowExport(row: RawAuditExportRow): AuditRowExport {
  return { ...row, chain_seq: Number(row.chain_seq) };
}

/** The tenant's whole chain in export form, ordered by chain_seq. Runs under RLS. */
export async function exportAuditChain(tx: Tx, organizationId: string): Promise<AuditRowExport[]> {
  const result = await tx.execute<RawAuditExportRow>(
    sql`SELECT ${sql.raw(AUDIT_EXPORT_COLUMNS)} FROM audit.audit_event
        WHERE organization_id = ${organizationId}::uuid ORDER BY chain_seq`,
  );
  return result.rows.map(toAuditRowExport);
}

export interface SqlChainVerification {
  ok: boolean;
  eventsChecked: number;
  firstBadSeq: number | null;
  detail: string | null;
}

/** Runs the database-side verifier audit.verify_chain() for one tenant. */
export async function verifyAuditChainInDb(
  tx: Tx,
  organizationId: string,
): Promise<SqlChainVerification> {
  const result = await tx.execute<{
    ok: boolean;
    events_checked: string;
    first_bad_seq: string | null;
    detail: string | null;
  }>(sql`SELECT * FROM audit.verify_chain(${organizationId}::uuid)`);
  const row = result.rows[0];
  if (!row) throw new Error('audit.verify_chain returned no row');
  return {
    ok: row.ok,
    eventsChecked: Number(row.events_checked),
    firstBadSeq: row.first_bad_seq === null ? null : Number(row.first_bad_seq),
    detail: row.detail,
  };
}
