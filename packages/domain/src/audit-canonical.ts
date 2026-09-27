/**
 * Audit-log canonical form and hash-chain verification (ADR-0008 section 2).
 *
 * row_hash = SHA-256( prev_hash || UTF-8( JCS(row without row_hash) ) )
 *
 * JCS is RFC 8785. The database function audit.canonical_text() is the single writer's
 * serializer; this module must produce byte-identical output, and the @deemed/db
 * integration tests compare the two on every stored row.
 *
 * Supported subset (both serializers reject anything outside it, so they never disagree):
 *  - object keys match /^[A-Za-z0-9_.:-]+$/ (ASCII, so code-unit order = byte order);
 *  - numbers are 0, or 1e-6 <= |n| < 1e21 with at most 15 significant digits.
 *
 * Pure and portable: SHA-256 uses Web Crypto (Node 22 and browsers), so the customer
 * verification tool can reuse it.
 */

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Version of the canonical form. Adding an audit column bumps it; old serializers stay. */
export const AUDIT_SCHEMA_VERSION = 1;

const KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export class CanonicalFormError extends Error {
  override name = 'CanonicalFormError';
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) throw new CanonicalFormError('non-finite number');
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e21 || abs < 1e-6)
    throw new CanonicalFormError(`number ${n} is outside the supported range`);
  const text = String(n);
  const digits = text.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  if (digits.length > 15)
    throw new CanonicalFormError(`number ${text} has more than 15 significant digits`);
  return text;
}

/** RFC 8785 serialization of a JSON value, restricted to the supported subset. */
export function jcs(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return canonicalNumber(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => jcs(v)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== undefined,
      );
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries
        .map(([k, v]) => {
          if (!KEY_PATTERN.test(k))
            throw new CanonicalFormError(`object key ${JSON.stringify(k)} is not allowed`);
          return `${JSON.stringify(k)}:${jcs(v)}`;
        })
        .join(',')}}`;
    }
    default:
      throw new CanonicalFormError(`unsupported value of type ${typeof value}`);
  }
}

/**
 * One audit row in its export (text) form, exactly as the customer export and the
 * verifier read it: uuids lowercase, occurred_at RFC 3339 UTC with microseconds,
 * bytea lowercase hex, inet in standard output form (no /32 or /128 on a host), NULL as null.
 */
export interface AuditRowExport {
  id: string;
  organization_id: string;
  chain_seq: number;
  occurred_at: string;
  category: string;
  action: string;
  outcome: string;
  actor_type: string;
  actor_person_id: string | null;
  actor_user_id: string | null;
  actor_label: string;
  on_behalf_of_id: string | null;
  session_id: string | null;
  request_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  site_id: string | null;
  target_table: string | null;
  target_id: string | null;
  requirement_ids: string[] | null;
  reason: string | null;
  diff: JsonValue | null;
  metadata: JsonValue;
  schema_version: number;
  prev_hash: string;
  row_hash: string;
}

/** Canonical text of a row: every column except row_hash. */
export function canonicalAuditRow(row: AuditRowExport): string {
  if (row.schema_version !== AUDIT_SCHEMA_VERSION) {
    throw new CanonicalFormError(`no serializer for audit schema_version ${row.schema_version}`);
  }
  const { row_hash: _omit, ...rest } = row;
  void _omit;
  return jcs(rest);
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new CanonicalFormError('invalid lowercase hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256(prev_hash || UTF-8(canonical)) as lowercase hex. */
export async function computeAuditRowHash(row: AuditRowExport): Promise<string> {
  const prev = hexToBytes(row.prev_hash);
  const body = new TextEncoder().encode(canonicalAuditRow(row));
  const input = new Uint8Array(prev.length + body.length);
  input.set(prev, 0);
  input.set(body, prev.length);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

export interface ChainVerification {
  ok: boolean;
  eventsChecked: number;
  /** chain_seq of the first row that fails, when ok is false. */
  firstBadSeq: number | null;
  detail: string | null;
}

/**
 * Verifies one organization's full chain from genesis. Rows must be the complete
 * export ordered by chain_seq. Never "repairs" anything (ADR-0008 section 2).
 */
export async function verifyAuditChain(
  rows: readonly AuditRowExport[],
): Promise<ChainVerification> {
  let prev = GENESIS_PREV_HASH;
  let expected = 1;
  const fail = (detail: string): ChainVerification => ({
    ok: false,
    eventsChecked: expected - 1,
    firstBadSeq: expected,
    detail,
  });
  if (rows.length === 0)
    return { ok: false, eventsChecked: 0, firstBadSeq: 1, detail: 'no events' };
  for (const row of rows) {
    if (row.chain_seq !== expected) return fail('gap in chain_seq');
    if (expected === 1 && row.action !== 'audit.genesis')
      return fail('chain does not start with audit.genesis');
    if (row.prev_hash !== prev) return fail('prev_hash does not match the previous row_hash');
    if ((await computeAuditRowHash(row)) !== row.row_hash)
      return fail('row_hash does not match the row content');
    prev = row.row_hash;
    expected += 1;
  }
  return { ok: true, eventsChecked: expected - 1, firstBadSeq: null, detail: null };
}
