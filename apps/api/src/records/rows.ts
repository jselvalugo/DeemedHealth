/**
 * SQL for the generic record API. Every statement is built from registry constants
 * (identifiers quoted with sql.identifier) and parameters (values, cast by field kind);
 * no request text is ever spliced into SQL.
 *
 * Scope before paging (ADR-0014 section 2.2): the viewer's site scope and record rules
 * are compiled from `permissionScope()` into the WHERE clause, so a page never contains a
 * row the viewer cannot see and counts never reveal one. The same rules run in memory on
 * every row afterwards (scope.ts) as a second check.
 *
 * Keyset pagination: rows are ordered by the sort fields (NULLs last), then `id`. The
 * cursor names only the last row's id (no personal data in cursors, section 4.5); the
 * next page compares against that row's current values, read under RLS.
 */
import type { Tx } from '@deemed/db';
import {
  isHidden,
  isMasked,
  type FieldDef,
  type FieldKind,
  type ListFilter,
  type PermissionScope,
  type RecordTypeDef,
  type RecordTypeId,
  type RecordView,
  type SiteCoverage,
  type SortKey,
} from '@deemed/domain';
import { sql, type SQL } from 'drizzle-orm';
import { RECORD_BINDINGS, SITE_JOINS, uuidIn, type RecordBinding } from './bindings.js';

const CAST: Record<FieldKind, string> = {
  text: 'text',
  uuid: 'uuid',
  date: 'date',
  timestamp: 'timestamptz',
  enum: 'text',
  boolean: 'boolean',
  integer: 'integer',
  text_array: 'text[]',
};

/**
 * A timestamptz as RFC 3339 UTC text with milliseconds. Drizzle's driver hands raw
 * timestamps back as PostgreSQL text, so the API formats them in SQL, the same way the
 * audit export does.
 */
export function isoSql(expr: SQL): SQL {
  return sql`to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export function binding(def: RecordTypeDef): RecordBinding {
  return RECORD_BINDINGS[def.id as RecordTypeId];
}

export function col(column: string, alias = 't'): SQL {
  return sql`${sql.raw(alias)}.${sql.identifier(column)}`;
}

export function tableRef(def: RecordTypeDef): SQL {
  const dot = def.table.indexOf('.');
  return sql`${sql.identifier(def.table.slice(0, dot))}.${sql.identifier(def.table.slice(dot + 1))}`;
}

/** A parameter cast to the field's column type. */
export function typed(kind: FieldKind, value: unknown): SQL {
  if (value === null || value === undefined) return sql`NULL`;
  const v = Array.isArray(value) ? JSON.stringify(value) : value;
  return sql`${v}::${sql.raw(CAST[kind])}`;
}

function field(def: RecordTypeDef, name: string): FieldDef {
  const f = def.fields[name];
  if (!f) throw new Error(`${def.id}: unknown field ${name}`);
  return f;
}

// ---------------------------------------------------------------------------
// Site scope and record rules
// ---------------------------------------------------------------------------

/** text[] of the record's site ids; empty means organization-wide. */
export function sitesExpr(def: RecordTypeDef): SQL {
  const scope = def.siteScope;
  if (scope === 'organization') return sql`ARRAY[]::text[]`;
  if ('self' in scope) return sql`ARRAY[t.id::text]`;
  if ('column' in scope) {
    const c = col(scope.column);
    return sql`CASE WHEN ${c} IS NULL THEN ARRAY[]::text[] ELSE ARRAY[${c}::text] END`;
  }
  return SITE_JOINS[scope.via].sites;
}

/** The record has one of these sites. Organization-wide records never match. */
export function siteIn(def: RecordTypeDef, ids: readonly string[]): SQL {
  const scope = def.siteScope;
  if (ids.length === 0 || scope === 'organization') return sql`FALSE`;
  if ('self' in scope) return uuidIn(sql`t.id`, ids);
  if ('column' in scope) return uuidIn(col(scope.column), ids);
  return SITE_JOINS[scope.via].siteIn(ids);
}

function covered(def: RecordTypeDef, c: SiteCoverage): SQL {
  return c.all ? sql`TRUE` : siteIn(def, c.sites);
}

/** The compiled read scope: (full coverage) OR (own coverage AND the record is mine). */
export function scopePredicate(def: RecordTypeDef, scope: PermissionScope, personId: string): SQL {
  const own = binding(def).own;
  const ownAllowed =
    own && def.access.recordRules.includes('own') && (scope.own.all || scope.own.sites.length > 0)
      ? sql`(${covered(def, scope.own)} AND ${own.predicate(personId)})`
      : sql`FALSE`;
  return sql`(${covered(def, scope.full)} OR ${ownAllowed})`;
}

function ownersExpr(def: RecordTypeDef): SQL {
  const own = binding(def).own;
  return own && def.access.recordRules.includes('own') ? own.owners : sql`ARRAY[]::text[]`;
}

// ---------------------------------------------------------------------------
// Filters, search, archive state, sort
// ---------------------------------------------------------------------------

export function filterSql(def: RecordTypeDef, f: ListFilter): SQL {
  const fd = field(def, f.field);
  const c = col(fd.column);
  const v = (x: unknown) => typed(fd.kind, x);
  switch (f.op) {
    case 'eq':
      return sql`${c} = ${v(f.value)}`;
    case 'in':
      return sql`${c} IN (${sql.join(
        (f.value as readonly string[]).map((x) => v(x)),
        sql`, `,
      )})`;
    case 'lt':
      return sql`${c} < ${v(f.value)}`;
    case 'lte':
      return sql`${c} <= ${v(f.value)}`;
    case 'gt':
      return sql`${c} > ${v(f.value)}`;
    case 'gte':
      return sql`${c} >= ${v(f.value)}`;
    case 'between': {
      const [lo, hi] = f.value as readonly [string, string];
      return sql`${c} BETWEEN ${v(lo)} AND ${v(hi)}`;
    }
    case 'is_null':
      return f.value === true ? sql`${c} IS NULL` : sql`${c} IS NOT NULL`;
    case 'contains':
      return sql`strpos(lower(${c}), lower(${f.value as string}::text)) > 0`;
  }
}

/** `q` over searchable fields: substring (case-insensitive) or exact. */
export function searchSql(def: RecordTypeDef, q: string): SQL {
  const terms: SQL[] = [];
  for (const f of Object.values(def.fields)) {
    if (!f.searchable) continue;
    const c = f.kind === 'text' ? col(f.column) : sql`${col(f.column)}::text`;
    terms.push(
      f.searchable === 'text'
        ? sql`strpos(lower(${c}), lower(${q}::text)) > 0`
        : sql`lower(${c}) = lower(${q}::text)`,
    );
  }
  return terms.length ? sql`(${sql.join(terms, sql` OR `)})` : sql`FALSE`;
}

export function archivedSql(def: RecordTypeDef, mode: 'exclude' | 'only' | 'include'): SQL {
  if (!def.archivable || mode === 'include') return sql`TRUE`;
  return mode === 'exclude' ? sql`t.archived_at IS NULL` : sql`t.archived_at IS NOT NULL`;
}

interface SortPart {
  t: SQL;
  a: SQL;
  dir: 'asc' | 'desc';
  /** A NULL-flag component (compared with =, not IS NOT DISTINCT FROM). */
  flag: boolean;
}

function sortParts(def: RecordTypeDef, sort: readonly SortKey[]): SortPart[] {
  const parts: SortPart[] = [];
  sort.forEach((key, i) => {
    const f = field(def, key.field);
    const t = col(f.column);
    const a = sql`a.${sql.identifier(`k${i}`)}`;
    // NULLs sort last in both directions.
    if (f.nullable)
      parts.push({ t: sql`(${t} IS NULL)`, a: sql`(${a} IS NULL)`, dir: 'asc', flag: true });
    parts.push({ t, a, dir: key.dir, flag: false });
  });
  parts.push({ t: sql`t.id`, a: sql`a.kid`, dir: 'asc', flag: false });
  return parts;
}

export function orderBySql(def: RecordTypeDef, sort: readonly SortKey[]): SQL {
  return sql.join(
    sortParts(def, sort).map((p) => sql`${p.t} ${sql.raw(p.dir === 'asc' ? 'ASC' : 'DESC')}`),
    sql`, `,
  );
}

/** Rows strictly after the anchor row in sort order (lexicographic over the parts). */
function keysetSql(def: RecordTypeDef, sort: readonly SortKey[]): SQL {
  const parts = sortParts(def, sort);
  const terms: SQL[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as SortPart;
    const equalBefore = parts
      .slice(0, i)
      .map((q) => (q.flag ? sql`${q.t} = ${q.a}` : sql`${q.t} IS NOT DISTINCT FROM ${q.a}`));
    const after = p.dir === 'asc' ? sql`${p.t} > ${p.a}` : sql`${p.t} < ${p.a}`;
    terms.push(sql`(${sql.join([...equalBefore, after], sql` AND `)})`);
  }
  return sql`(${sql.join(terms, sql` OR `)})`;
}

function anchorSql(def: RecordTypeDef, sort: readonly SortKey[], anchorId: string): SQL {
  const keys = sort.map(
    (key, i) => sql`${col(field(def, key.field).column, 's')} AS ${sql.identifier(`k${i}`)}`,
  );
  return sql`(SELECT ${sql.join([...keys, sql`s.id AS kid`], sql`, `)}
              FROM ${tableRef(def)} s WHERE s.id = ${anchorId}::uuid) a`;
}

// ---------------------------------------------------------------------------
// Selecting rows
// ---------------------------------------------------------------------------

export interface Row {
  __id: string;
  __v?: number;
  __archived_at?: string | null;
  __archived_by?: string | null;
  __archive_reason?: string | null;
  __sites: string[];
  __owners: string[];
  [field: string]: unknown;
}

function selectList(def: RecordTypeDef): SQL {
  const parts: SQL[] = [sql`t.id::text AS "__id"`];
  if (def.versioned) parts.push(sql`t.row_version AS "__v"`);
  if (def.archivable) {
    parts.push(
      sql`${isoSql(sql`t.archived_at`)} AS "__archived_at"`,
      sql`t.archived_by::text AS "__archived_by"`,
      sql`t.archive_reason AS "__archive_reason"`,
    );
  }
  parts.push(sql`${sitesExpr(def)} AS "__sites"`, sql`${ownersExpr(def)} AS "__owners"`);
  for (const [name, f] of Object.entries(def.fields)) {
    if (isHidden(def, name)) continue;
    const c = col(f.column);
    const alias = sql.identifier(name);
    if (isMasked(def, name)) parts.push(sql`(${c} IS NOT NULL) AS ${alias}`);
    else if (f.kind === 'date' || f.kind === 'uuid') parts.push(sql`${c}::text AS ${alias}`);
    else if (f.kind === 'timestamp') parts.push(sql`${isoSql(c)} AS ${alias}`);
    else parts.push(sql`${c} AS ${alias}`);
  }
  return sql.join(parts, sql`, `);
}

export interface SelectOptions {
  where: readonly SQL[];
  sort?: readonly SortKey[];
  /** Keyset: rows after this record id in `sort` order. */
  after?: string;
  limit?: number;
  forUpdate?: boolean;
}

export async function selectRows(tx: Tx, def: RecordTypeDef, o: SelectOptions): Promise<Row[]> {
  const where = [...o.where];
  const from = o.after
    ? sql`${tableRef(def)} t CROSS JOIN ${anchorSql(def, o.sort ?? [], o.after)}`
    : sql`${tableRef(def)} t`;
  if (o.after) where.push(keysetSql(def, o.sort ?? []));
  const query = sql`SELECT ${selectList(def)} FROM ${from}
    WHERE ${where.length ? sql.join(where, sql` AND `) : sql`TRUE`}
    ${o.sort ? sql`ORDER BY ${orderBySql(def, o.sort)}` : sql``}
    ${o.limit !== undefined ? sql`LIMIT ${o.limit}` : sql``}
    ${o.forUpdate ? sql`FOR UPDATE OF t` : sql``}`;
  const result = await tx.execute<Row>(query);
  return result.rows;
}

export async function countRows(
  tx: Tx,
  def: RecordTypeDef,
  where: readonly SQL[],
): Promise<number> {
  const r = await tx.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM ${tableRef(def)} t
        WHERE ${where.length ? sql.join([...where], sql` AND `) : sql`TRUE`}`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

export async function loadRow(
  tx: Tx,
  def: RecordTypeDef,
  id: string,
  forUpdate = false,
): Promise<Row | undefined> {
  return (await selectRows(tx, def, { where: [sql`t.id = ${id}::uuid`], limit: 1, forUpdate }))[0];
}

// ---------------------------------------------------------------------------
// Serialization (layer 6: the field serializer)
// ---------------------------------------------------------------------------

/**
 * A row as the API returns it: hidden fields never; masked fields as `{ masked, hasValue }`
 * on a single record and not at all in lists (a reveal is never cached in a list).
 */
export function toView(def: RecordTypeDef, row: Row, mode: 'record' | 'list'): RecordView {
  const fields: RecordView['fields'] = {};
  for (const name of Object.keys(def.fields)) {
    if (isHidden(def, name)) continue;
    if (isMasked(def, name)) {
      if (mode === 'record') fields[name] = { masked: true, hasValue: row[name] === true };
      continue;
    }
    fields[name] = (row[name] ?? null) as RecordView['fields'][string];
  }
  return {
    id: row.__id,
    rowVersion: def.versioned ? (row.__v ?? null) : null,
    archivedAt: row.__archived_at ?? null,
    fields,
  };
}

/** Plain field values of a row, keyed by field (for rules and diffs). */
export function fieldValues(def: RecordTypeDef, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(def.fields)) {
    if (isHidden(def, name) || isMasked(def, name)) continue;
    out[name] = row[name] ?? null;
  }
  return out;
}

/** Field values to column values (for audit diffs, which the data dictionary keys by column). */
export function toColumns(
  def: RecordTypeDef,
  values: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | null | string[]> {
  const out: Record<string, string | number | boolean | null | string[]> = {};
  for (const [name, v] of Object.entries(values)) {
    const f = def.fields[name];
    if (f) out[f.column] = (v ?? null) as string | number | boolean | null | string[];
  }
  return out;
}
