/**
 * The list query of the generic record API (ADR-0014 section 2.1):
 *
 *   filter[<field>][<op>]=<value>   only on `filterable` fields, operators by field kind
 *   sort=<field>,-<field>           only on `sortable` fields (`-` = descending); the API
 *                                   appends `id` as the tiebreaker
 *   q=<text>                        searches `searchable` fields
 *   limit=1..200 (default 50), cursor=<opaque>, archived=exclude|only|include, view=<id>
 *
 * Parsing is pure and loop-based (no backtracking regex on input). Errors name the
 * offending parameter, never its value. Restricted fields are never filterable,
 * sortable, or searchable (the registry test guarantees it), so a query can never touch
 * a masked, hidden, or PHI column.
 */
import { IsoDate, Uuid, UtcTimestamp } from '../primitives.js';
import { isSsnShapedValue } from '../ssn-detector.js';
import type { FieldDef, FieldKind, RecordTypeDef } from './define.js';
import { isFieldName } from './validate.js';

export const FILTER_OPS = [
  'eq',
  'in',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'is_null',
  'contains',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

const OPS_BY_KIND: Record<FieldKind, readonly FilterOp[]> = {
  text: ['eq', 'in'],
  uuid: ['eq', 'in'],
  enum: ['eq', 'in'],
  date: ['eq', 'lt', 'lte', 'gt', 'gte', 'between'],
  timestamp: ['lt', 'lte', 'gt', 'gte', 'between'],
  boolean: ['eq'],
  integer: ['eq', 'in', 'lt', 'lte', 'gt', 'gte', 'between'],
  text_array: [],
};

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 200;
export const IN_MAX_VALUES = 50;
export const SORT_MAX_KEYS = 3;
export const TEXT_VALUE_MAX = 200;

/** Operators a field accepts. */
export function filterOps(f: FieldDef): FilterOp[] {
  if (!f.filterable) return [];
  const ops: FilterOp[] = [...OPS_BY_KIND[f.kind]];
  if (f.nullable) ops.push('is_null');
  if (f.kind === 'text' && f.searchable === 'text') ops.push('contains');
  return ops;
}

export type FilterValue = string | readonly string[] | boolean;

export interface ListFilter {
  field: string;
  op: FilterOp;
  /** `in`: 1..50 values; `between`: [low, high]; `is_null`: boolean; otherwise one value. */
  value: FilterValue;
}

export interface SortKey {
  field: string;
  dir: 'asc' | 'desc';
}

export type ArchivedMode = 'exclude' | 'only' | 'include';

export interface ListQuery {
  filters: ListFilter[];
  sort: SortKey[];
  q: string | null;
  limit: number;
  cursor: string | null;
  archived: ArchivedMode;
  view: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; fields: string[] };

function isDigits(value: string, allowSign: boolean): boolean {
  if (value.length === 0 || value.length > 15) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (i === 0 && allowSign && c === 45 && value.length > 1) continue;
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** One scalar value for a field kind; null when invalid. */
export function checkScalar(f: FieldDef, raw: string): string | null {
  switch (f.kind) {
    case 'uuid':
      return Uuid.safeParse(raw).success ? raw : null;
    case 'date':
      return IsoDate.safeParse(raw).success ? raw : null;
    case 'timestamp':
      return UtcTimestamp.safeParse(raw).success ? raw : null;
    case 'enum':
      return f.values?.includes(raw) ? raw : null;
    case 'integer':
      return isDigits(raw, true) ? raw : null;
    case 'boolean':
      return raw === 'true' || raw === 'false' ? raw : null;
    case 'text': {
      const text = raw.trim();
      if (text.length === 0 || text.length > TEXT_VALUE_MAX) return null;
      // D1: an SSN-shaped value is never accepted, not even as a filter.
      return isSsnShapedValue(text) ? null : text;
    }
    default:
      return null;
  }
}

function compare(f: FieldDef, a: string, b: string): number {
  if (f.kind === 'integer') return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validates one filter; `raw` is a list for `in` and `between` (already split). */
export function checkFilter(
  def: RecordTypeDef,
  field: string,
  op: string,
  raw: string | readonly string[],
): ListFilter | null {
  const f = Object.prototype.hasOwnProperty.call(def.fields, field) ? def.fields[field] : undefined;
  if (!f || !(filterOps(f) as readonly string[]).includes(op)) return null;
  const list = typeof raw === 'string' ? [raw] : raw;
  switch (op as FilterOp) {
    case 'is_null':
      if (list.length !== 1 || (list[0] !== 'true' && list[0] !== 'false')) return null;
      return { field, op: 'is_null', value: list[0] === 'true' };
    case 'in': {
      if (list.length === 0 || list.length > IN_MAX_VALUES) return null;
      const values: string[] = [];
      for (const v of list) {
        const ok = checkScalar(f, v);
        if (ok === null) return null;
        if (!values.includes(ok)) values.push(ok);
      }
      return { field, op: 'in', value: values };
    }
    case 'between': {
      if (list.length !== 2) return null;
      const lo = checkScalar(f, list[0] as string);
      const hi = checkScalar(f, list[1] as string);
      if (lo === null || hi === null || compare(f, lo, hi) > 0) return null;
      return { field, op: 'between', value: [lo, hi] };
    }
    case 'contains': {
      if (list.length !== 1) return null;
      const v = checkScalar(f, list[0] as string);
      return v === null ? null : { field, op: 'contains', value: v };
    }
    default: {
      if (list.length !== 1) return null;
      const v = checkScalar(f, list[0] as string);
      return v === null ? null : { field, op: op as FilterOp, value: v };
    }
  }
}

/** Splits `a,b,c` on commas (loop; empty parts kept so they fail validation). */
function splitComma(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || value.charCodeAt(i) === 44) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

/** `filter[field][op]` → [field, op], or null. */
export function parseFilterKey(key: string): [string, string] | null {
  const prefix = 'filter[';
  if (!key.startsWith(prefix) || !key.endsWith(']')) return null;
  const inner = key.slice(prefix.length, -1);
  const sep = inner.indexOf('][');
  if (sep < 0 || inner.indexOf('][', sep + 1) >= 0) return null;
  const field = inner.slice(0, sep);
  const op = inner.slice(sep + 2);
  if (!isFieldName(field) || !(FILTER_OPS as readonly string[]).includes(op)) return null;
  return [field, op];
}

/** `sort=a,-b`; empty uses the type's default sort. */
export function parseSort(def: RecordTypeDef, raw: string | undefined): SortKey[] | null {
  if (raw === undefined || raw === '') {
    return def.list.defaultSort.map((s) => ({ field: s.field, dir: s.dir }));
  }
  const parts = splitComma(raw);
  if (parts.length > SORT_MAX_KEYS) return null;
  const keys: SortKey[] = [];
  for (const part of parts) {
    const desc = part.startsWith('-');
    const field = desc ? part.slice(1) : part;
    const f = Object.prototype.hasOwnProperty.call(def.fields, field) ? def.fields[field] : null;
    if (!f?.sortable || keys.some((k) => k.field === field)) return null;
    keys.push({ field, dir: desc ? 'desc' : 'asc' });
  }
  return keys;
}

export function checkSearch(raw: string | undefined): string | null | false {
  if (raw === undefined) return null;
  const q = raw.trim();
  if (q.length === 0) return null;
  if (q.length > TEXT_VALUE_MAX || isSsnShapedValue(q)) return false;
  return q;
}

export type RawQuery = Readonly<Record<string, string | readonly string[] | undefined>>;

const PLAIN_KEYS = ['q', 'sort', 'limit', 'cursor', 'archived', 'view'] as const;

/** Parses the list query string of a record type. */
export function parseListQuery(def: RecordTypeDef, raw: RawQuery): ParseResult<ListQuery> {
  const bad: string[] = [];
  const one = (key: string): string | undefined => {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') {
      bad.push(key);
      return undefined;
    }
    return v;
  };
  const filters: ListFilter[] = [];
  for (const key of Object.keys(raw)) {
    if ((PLAIN_KEYS as readonly string[]).includes(key)) continue;
    const parsed = parseFilterKey(key);
    const value = one(key);
    if (!parsed || value === undefined) {
      if (!bad.includes(key)) bad.push(parsed ? key : 'query');
      continue;
    }
    const [field, op] = parsed;
    const filter = checkFilter(
      def,
      field,
      op,
      op === 'in' || op === 'between' ? splitComma(value) : value,
    );
    if (!filter) bad.push(`filter.${field}`);
    else filters.push(filter);
  }
  if (filters.length > 20) bad.push('filter');

  const sort = parseSort(def, one('sort'));
  if (!sort) bad.push('sort');

  const q = checkSearch(one('q'));
  if (q === false) bad.push('q');
  if (q && !Object.values(def.fields).some((f) => f.searchable)) bad.push('q');

  let limit = LIST_LIMIT_DEFAULT;
  const rawLimit = one('limit');
  if (rawLimit !== undefined) {
    if (!isDigits(rawLimit, false) || Number(rawLimit) < 1 || Number(rawLimit) > LIST_LIMIT_MAX) {
      bad.push('limit');
    } else limit = Number(rawLimit);
  }

  const cursor = one('cursor') ?? null;
  if (cursor !== null && (cursor.length === 0 || cursor.length > 512)) bad.push('cursor');

  const archivedRaw = one('archived') ?? 'exclude';
  const archived = (['exclude', 'only', 'include'] as const).find((m) => m === archivedRaw);
  if (!archived) bad.push('archived');
  if (archived !== 'exclude' && archived !== undefined && !def.archivable) bad.push('archived');

  const view = one('view') ?? null;
  if (view !== null && !Uuid.safeParse(view).success) bad.push('view');

  if (bad.length > 0) return { ok: false, fields: [...new Set(bad)] };
  return {
    ok: true,
    value: {
      filters,
      sort: sort as SortKey[],
      q: q || null,
      limit,
      cursor,
      archived: archived as ArchivedMode,
      view,
    },
  };
}

/** A saved view's stored query: the same filters, sort, and search, as JSON. */
export interface StoredQuery {
  filters: readonly { field: string; op: string; value: string | readonly string[] }[];
  sort: readonly { field: string; dir: 'asc' | 'desc' }[];
  q?: string | null;
}

/** Validates a stored query against the type (saved views never filter restricted fields). */
export function checkStoredQuery(
  def: RecordTypeDef,
  stored: StoredQuery,
): ParseResult<{ filters: ListFilter[]; sort: SortKey[]; q: string | null }> {
  const bad: string[] = [];
  const filters: ListFilter[] = [];
  for (const f of stored.filters) {
    const ok = checkFilter(def, f.field, f.op, f.value);
    if (!ok) bad.push(`query.filters.${f.field}`);
    else filters.push(ok);
  }
  const sort: SortKey[] = [];
  for (const s of stored.sort) {
    const f = Object.prototype.hasOwnProperty.call(def.fields, s.field)
      ? def.fields[s.field]
      : null;
    if (!f?.sortable || sort.some((k) => k.field === s.field)) bad.push(`query.sort.${s.field}`);
    else sort.push({ field: s.field, dir: s.dir });
  }
  const q = checkSearch(stored.q ?? undefined);
  if (q === false) bad.push('query.q');
  if (bad.length > 0) return { ok: false, fields: bad };
  return { ok: true, value: { filters, sort, q: q || null } };
}

/** Deterministic text of a query's shape, for binding cursors to it. */
export function queryFingerprint(
  typeId: string,
  query: Pick<ListQuery, 'filters' | 'sort' | 'q' | 'archived' | 'view'>,
): string {
  const filters = [...query.filters]
    .map((f) => [f.field, f.op, f.value])
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return JSON.stringify([typeId, filters, query.sort, query.q, query.archived, query.view]);
}
