/**
 * Audit diffs (ADR-0008 section 5): the before/after of changed columns only, redacted by
 * the sensitivity class in the data dictionary. PII/PHI and field-encrypted values never
 * enter the log, free text keeps only its length (and a per-tenant HMAC when a digest is
 * given), and a column missing from the dictionary is an error, not a silent pass-through.
 * Shared by the API's audit middleware and the domain services that write their own
 * events (readiness).
 */
import type { JsonValue } from '@deemed/domain';
import { DATA_DICTIONARY } from '../data-dictionary.js';

type Row = Record<string, JsonValue | Date | undefined>;

function plain(value: JsonValue | Date | undefined): JsonValue {
  if (value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** A keyed digest of free text for one tenant (AuthService.textDigest). */
export interface TextDigest {
  digest(text: string): string;
  keyId: string;
}

/**
 * Free text (reasons, comments): never the words. Only the length and, when a keyed
 * digest is given, its HMAC under the tenant's key (ADR-0008 section 5); never an
 * unsalted hash, which could be tested against guessed texts.
 */
function redactText(value: JsonValue, digest: TextDigest | undefined): JsonValue {
  if (value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return {
    redacted: true,
    length: [...text].length,
    ...(digest ? { hmac_sha256: digest.digest(text), digest_key: digest.keyId } : {}),
  };
}

/** `{ fields: { column: { before, after } } }` for changed columns, redacted by class. */
export function redactedDiff(
  table: string,
  before: Row | null,
  after: Row | null,
  digest?: TextDigest,
): JsonValue {
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
    if (spec.freeText) {
      fields[column] = { before: redactText(b, digest), after: redactText(a, digest) };
    } else if (spec.encryption || spec.class === 'PII' || spec.class === 'PHI') {
      fields[column] = { changed: true, redacted: true };
    } else {
      fields[column] = { before: b, after: a };
    }
  }
  return { fields };
}
