/**
 * The generic record API (ADR-0014 section 2). One handler per action serves every
 * registered record type. Each runs in `withTenant` as the signed-in user (RLS, layer 1),
 * after the S3 middleware checked the route's permission (layer 3); it applies site
 * scope and record rules in SQL before paging and in memory on every row (layers 4 and
 * 5, scope.ts), serializes with the field rules (layer 6, rows.ts), and writes its audit
 * event in the same transaction (the audit middleware refuses a mutation without one).
 */
import { createHash, randomUUID } from 'node:crypto';
import { appendAuditEvent, type TransactionContext, type Tx } from '@deemed/db';
import {
  ArchiveRequest,
  BulkRequest,
  COLUMN_CLASSES,
  EXPORT_MAX_ROWS,
  ExportRequest,
  RestoreRequest,
  RevealRequest,
  bareTable,
  bulkUpdateSchema,
  createSchema,
  getRecordType,
  isListable,
  isProduction,
  parseListQuery,
  permissionScope,
  queryFingerprint,
  revealAction,
  ruleProblems,
  toCsv,
  updateSchema,
  type AuditAction,
  type BulkResponse,
  type BulkRowStatus,
  type HistoryResponse,
  type JsonValue,
  type ListQuery,
  type RawQuery,
  type RecordGetResponse,
  type RecordListResponse,
  type RecordTypeDef,
  type RecordView,
} from '@deemed/domain';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { redactedDiff } from '../audit.js';
import type { Handler, Helpers } from '../context.js';
import { ApiError, DeniedError } from '../errors.js';
import { ARCHIVE_BLOCKER_SQL } from './bindings.js';
import { signCursor, verifyCursor } from './cursor.js';
import { digestOf, ifMatch, type RecordCall } from './http.js';
import { importDryRun } from './import.js';
import {
  RECORD_ROUTE_META,
  type RecordRouteAction,
  type RecordRouteId,
  type RecordRouteMeta,
} from './manifest.js';
import {
  archivedSql,
  binding,
  col,
  countRows,
  fieldValues,
  filterSql,
  isoSql,
  loadRow,
  scopePredicate,
  searchSql,
  selectRows,
  tableRef,
  toColumns,
  toView,
  typed,
  type Row,
} from './rows.js';
import {
  decideRecord,
  historyAllowed,
  newResource,
  requireAction,
  requireVisible,
  resourceOf,
  targetOf,
} from './scope.js';
import { applySavedView, savedViewHandlers } from './views.js';

const IdParams = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export function etag(row: Row): string {
  return `"${row.__v ?? 1}"`;
}

function siteOf(row: Row): { siteId: string } | Record<string, never> {
  return row.__sites.length === 1 ? { siteId: row.__sites[0] as string } : {};
}

function requirementIdsOf(def: RecordTypeDef, row: Row): string[] {
  const ids = [...def.requirementIds];
  const f = def.rowRequirementIdField;
  const v = f ? row[f] : undefined;
  if (typeof v === 'string' && !ids.includes(v)) ids.push(v);
  return ids;
}

type Diffable = Record<string, JsonValue | Date | undefined>;

/** One `<type>.<verb>` mutation event, with the redacted diff of the changed columns. */
export async function appendMutation(
  h: Helpers,
  tx: Tx,
  txCtx: TransactionContext,
  def: RecordTypeDef,
  verb: 'create' | 'update' | 'archive' | 'restore',
  row: Row,
  before: Diffable | null,
  after: Diffable,
  metadata: Record<string, JsonValue> = {},
): Promise<void> {
  await appendAuditEvent(tx, txCtx, {
    category: 'mutation',
    action: `${def.id}.${verb}` as AuditAction,
    targetTable: bareTable(def.table),
    targetId: row.__id,
    ...siteOf(row),
    requirementIds: requirementIdsOf(def, row),
    diff: redactedDiff(def.table, before, after, digestOf(h)),
    metadata: { record_type: def.id, row_version: row.__v ?? null, ...metadata },
    sessionId: h.session().id,
  });
}

/** Maps constraint errors to the stable model; everything else stays a 500. */
async function withDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && !(error instanceof ApiError)) {
      if (code === '23505') throw new ApiError('conflict');
      if (code === '23503' || code === '23514' || code === '23502')
        throw new ApiError('bad_request');
      if (code.startsWith('22')) throw new ApiError('bad_request');
    }
    throw error;
  }
}

/** Fields changed since `expected`, from the record's own audit events (names only). */
async function versionConflict(
  tx: Tx,
  def: RecordTypeDef,
  row: Row,
  expected: number,
): Promise<ApiError> {
  const r = await tx.execute<{ col: string }>(sql`
    SELECT DISTINCT jsonb_object_keys(e.diff -> 'fields') AS col
    FROM audit.audit_event e
    WHERE e.target_table = ${bareTable(def.table)} AND e.target_id = ${row.__id}::uuid
      AND e.category = 'mutation' AND e.outcome = 'success'
      AND jsonb_typeof(e.metadata -> 'row_version') = 'number'
      AND (e.metadata ->> 'row_version')::numeric > ${expected}
      AND jsonb_typeof(e.diff -> 'fields') = 'object'`);
  const byColumn = new Map(Object.entries(def.fields).map(([n, f]) => [f.column, n]));
  const fields = [
    ...new Set(
      r.rows
        .map((x) => byColumn.get(x.col) ?? (x.col === 'archived_at' ? 'archivedAt' : undefined))
        .filter((x): x is string => x !== undefined && (x === 'archivedAt' || isListable(def, x))),
    ),
  ].sort();
  return new ApiError('version_conflict', fields, row.__v);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function updateColumns(
  tx: Tx,
  def: RecordTypeDef,
  id: string,
  expected: number,
  sets: SQL[],
): Promise<void> {
  const r = await tx.execute(sql`UPDATE ${tableRef(def)} t SET ${sql.join(sets, sql`, `)}
    WHERE t.id = ${id}::uuid AND t.row_version = ${expected} RETURNING t.id`);
  // The row is locked (FOR UPDATE) and its version checked, so this cannot miss.
  if (r.rows.length !== 1) throw new ApiError('version_conflict');
}

function fieldSets(def: RecordTypeDef, patch: Readonly<Record<string, unknown>>): SQL[] {
  return Object.entries(patch).map(([name, v]) => {
    const f = def.fields[name];
    if (!f) throw new Error(`${def.id}: unknown field ${name}`);
    return sql`${sql.identifier(f.column)} = ${typed(f.kind, v)}`;
  });
}

function listWhere(h: Helpers, def: RecordTypeDef, q: ListQuery): SQL[] {
  const p = h.principal();
  const scope = permissionScope(p, def.access.read, h.now());
  return [
    scopePredicate(def, scope, p.personId),
    archivedSql(def, q.archived),
    ...q.filters.map((f) => filterSql(def, f)),
    ...(q.q ? [searchSql(def, q.q)] : []),
  ];
}

/** Defense in depth: every row the SQL scope returned must pass the in-memory policy. */
function assertInScope(h: Helpers, def: RecordTypeDef, rows: readonly Row[]): void {
  for (const row of rows) {
    if (!decideRecord(h, def.access.read, resourceOf(row), 'any').allowed) {
      throw new Error('records: a row outside the viewer scope reached the result');
    }
  }
}

function archivedAllowed(h: Helpers, def: RecordTypeDef, q: ListQuery): void {
  if (q.archived !== 'exclude' && !h.decide(def.access.update).allowed) {
    throw new DeniedError('permission');
  }
}

function allowedActions(
  h: Helpers,
  def: RecordTypeDef,
  row: Row,
  read: ReturnType<typeof requireVisible>,
) {
  const out: RecordGetResponse['allowedActions'] = [];
  const res = resourceOf(row);
  const can = (p: Parameters<typeof decideRecord>[1]) => decideRecord(h, p, res, 'all').allowed;
  const archived = row.__archived_at != null;
  if (def.actions.includes('update') && !archived && can(def.access.update)) out.push('update');
  if (def.actions.includes('archive') && !archived && can(def.access.archive)) out.push('archive');
  if (def.actions.includes('restore') && archived && can(def.access.update)) out.push('restore');
  if (historyAllowed(h, def, read)) out.push('history');
  return out;
}

function revealable(h: Helpers, def: RecordTypeDef, row: Row): string[] {
  if (!def.actions.includes('reveal')) return [];
  return Object.entries(def.fields)
    .filter(
      ([, f]) =>
        f.reveal &&
        decideRecord(h, def.access.read, resourceOf(row), 'any', f.reveal.roles).allowed,
    )
    .map(([n]) => n);
}

async function lockVisible(c: RecordCall, tx: Tx, id: string): Promise<Row> {
  const row = await loadRow(tx, c.def, id, true);
  // RLS hides other tenants' rows: "not found", never "forbidden".
  if (!row) throw new ApiError('not_found');
  requireVisible(c.h, c.def, row);
  return row;
}

async function archiveBlockers(tx: Tx, def: RecordTypeDef, id: string): Promise<string[]> {
  const blocked: string[] = [];
  for (const b of def.archiveBlockedBy ?? []) {
    const r = await tx.execute<{ blocked: boolean }>(
      sql`SELECT ${ARCHIVE_BLOCKER_SQL[b]} AS blocked FROM ${tableRef(def)} t WHERE t.id = ${id}::uuid`,
    );
    if (r.rows[0]?.blocked) blocked.push(`blockedBy.${b}`);
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function list(c: RecordCall): Promise<RecordListResponse> {
  const { h, def, req } = c;
  const raw = (req.query ?? {}) as RawQuery;
  const parsed = parseListQuery(def, raw);
  if (!parsed.ok) throw new ApiError('bad_request', parsed.fields);
  archivedAllowed(h, def, parsed.value);
  return h.tenant(async (tx, txCtx) => {
    const q = await applySavedView(tx, h, def, parsed.value, raw.sort !== undefined);
    const where = listWhere(h, def, q);
    const fingerprint = queryFingerprint(def.id, q);
    const after = q.cursor ? verifyCursor(h, 'list', def.id, fingerprint, q.cursor) : undefined;
    const rows = await selectRows(tx, def, {
      where,
      sort: q.sort,
      limit: q.limit + 1,
      ...(after ? { after } : {}),
    });
    const page = rows.slice(0, q.limit);
    assertInScope(h, def, page);
    const total = await countRows(tx, def, where);
    await h.recordListView(
      tx,
      txCtx,
      bareTable(def.table),
      page.map((r) => r.__id),
    );
    const last = page[page.length - 1];
    return {
      recordType: def.id,
      items: page.map((r) => toView(def, r, 'list')),
      nextCursor:
        rows.length > q.limit && last
          ? signCursor(h, 'list', def.id, fingerprint, last.__id)
          : null,
      total,
      limit: q.limit,
    };
  });
}

async function get(c: RecordCall): Promise<RecordGetResponse> {
  const { h, def, reply } = c;
  const { id } = h.params(IdParams);
  return h.tenant(async (tx, txCtx) => {
    const row = await loadRow(tx, def, id);
    if (!row) throw new ApiError('not_found');
    const read = requireVisible(h, def, row);
    await h.recordView(tx, txCtx, targetOf(def, row));
    if (def.versioned) reply.header('etag', etag(row));
    return {
      recordType: def.id,
      record: toView(def, row, 'record'),
      allowedActions: allowedActions(h, def, row, read),
      revealable: revealable(h, def, row),
    };
  });
}

async function create(c: RecordCall): Promise<{ recordType: string; record: RecordView }> {
  const { h, def, reply } = c;
  const body = h.body(createSchema(def)) as Record<string, unknown>;
  return h.tenant(async (tx, txCtx) => {
    const bad = (await binding(def).validate?.(tx, body)) ?? [];
    if (bad.length > 0) throw new ApiError('bad_request', bad);

    // The new record's sites decide who may create it; without a site column it is
    // organization-level and needs an organization-wide grant.
    const d = decideRecord(h, def.access.create, newResource(def, body), 'all');
    if (!d.allowed) throw new DeniedError(d.reason);
    h.markRecordChecked();

    const columns: [string, SQL][] = [
      ['organization_id', sql`${txCtx.organizationId}::uuid`],
      ...Object.entries(body).map(([name, v]): [string, SQL] => {
        const f = def.fields[name];
        if (!f) throw new Error(`${def.id}: unknown field ${name}`);
        return [f.column, typed(f.kind, v)];
      }),
      ...Object.entries(binding(def).createDefaults ?? {}).map(([column, v]): [string, SQL] => [
        column,
        typeof v === 'boolean' ? sql`${v}::boolean` : sql`${v}::text`,
      ]),
    ];
    // Non-production data is synthetic by rule (D9): mark it so seeds and checks can tell.
    if (COLUMN_CLASSES[def.table]?.columns.is_test_record) {
      columns.push(['is_test_record', sql`${!isProduction(h.services.dhEnv)}::boolean`]);
    }
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO ${tableRef(def)} (${sql.join(
        columns.map(([name]) => sql.identifier(name)),
        sql`, `,
      )})
      VALUES (${sql.join(
        columns.map(([, v]) => v),
        sql`, `,
      )})
      RETURNING id::text AS id`);
    const row = await loadRow(tx, def, inserted.rows[0]?.id as string);
    if (!row) throw new Error('records: the created row is not readable');
    await appendMutation(
      h,
      tx,
      txCtx,
      def,
      'create',
      row,
      null,
      toColumns(def, fieldValues(def, row)) as Diffable,
    );
    reply.status(201);
    if (def.versioned) reply.header('etag', etag(row));
    return { recordType: def.id, record: toView(def, row, 'record') };
  });
}

async function update(c: RecordCall): Promise<{ recordType: string; record: RecordView }> {
  const { h, def, req, reply } = c;
  const { id } = h.params(IdParams);
  const expected = ifMatch(req);
  const patch = h.body(updateSchema(def)) as Record<string, unknown>;
  return h.tenant(async (tx, txCtx) => {
    const row = await lockVisible(c, tx, id);
    requireAction(h, def, row, def.access.update);
    // state_lock: archived records are read-only apart from restore.
    if (row.__archived_at) throw new ApiError('conflict', ['archivedAt']);
    if (row.__v !== expected) throw await versionConflict(tx, def, row, expected);

    const before = fieldValues(def, row);
    const merged = { ...before, ...patch };
    const bad = [
      ...ruleProblems(def, merged),
      ...((await binding(def).validate?.(tx, merged)) ?? []),
    ];
    if (bad.length > 0) throw new ApiError('bad_request', [...new Set(bad)]);

    const changed = Object.keys(patch).filter((k) => !sameValue(before[k], patch[k]));
    if (changed.length === 0) {
      h.declareNoChange();
      reply.header('etag', etag(row));
      return { recordType: def.id, record: toView(def, row, 'record') };
    }
    const changes = Object.fromEntries(changed.map((k) => [k, patch[k]]));
    await updateColumns(tx, def, id, expected, fieldSets(def, changes));
    const after = (await loadRow(tx, def, id)) as Row;
    const pick = (values: Record<string, unknown>) =>
      toColumns(def, Object.fromEntries(changed.map((k) => [k, values[k]]))) as Diffable;
    await appendMutation(
      h,
      tx,
      txCtx,
      def,
      'update',
      after,
      pick(before),
      pick(fieldValues(def, after)),
    );
    reply.header('etag', etag(after));
    return { recordType: def.id, record: toView(def, after, 'record') };
  });
}

function archiveDiff(row: Row): Diffable {
  return {
    archived_at: row.__archived_at ?? null,
    archived_by: row.__archived_by ?? null,
    archive_reason: row.__archive_reason ?? null,
  };
}

/** Archives one locked, visible row; returns the refused state or the archived row. */
async function archiveRow(
  h: Helpers,
  tx: Tx,
  def: RecordTypeDef,
  row: Row,
  expected: number,
  reason: string,
): Promise<
  | { status: 'archived'; row: Row }
  | { status: 'archived_already' }
  | { status: 'blocked'; fields: string[] }
  | { status: 'version_conflict'; error: ApiError }
> {
  if (row.__archived_at) return { status: 'archived_already' };
  if (row.__v !== expected)
    return { status: 'version_conflict', error: await versionConflict(tx, def, row, expected) };
  const blocked = await archiveBlockers(tx, def, row.__id);
  if (blocked.length > 0) return { status: 'blocked', fields: blocked };
  await updateColumns(tx, def, row.__id, expected, [
    sql`archived_at = now()`,
    sql`archived_by = ${h.session().userAccountId}::uuid`,
    sql`archive_reason = ${reason}::text`,
  ]);
  return { status: 'archived', row: (await loadRow(tx, def, row.__id)) as Row };
}

async function archive(c: RecordCall): Promise<{ recordType: string; record: RecordView }> {
  const { h, def, req, reply } = c;
  const { id } = h.params(IdParams);
  const expected = ifMatch(req);
  const { reason } = h.body(ArchiveRequest);
  return h.tenant(async (tx, txCtx) => {
    const row = await lockVisible(c, tx, id);
    requireAction(h, def, row, def.access.archive);
    const result = await archiveRow(h, tx, def, row, expected, reason);
    if (result.status === 'archived_already') throw new ApiError('conflict', ['archivedAt']);
    if (result.status === 'version_conflict') throw result.error;
    if (result.status === 'blocked') throw new ApiError('conflict', result.fields);
    await appendMutation(
      h,
      tx,
      txCtx,
      def,
      'archive',
      result.row,
      archiveDiff(row),
      archiveDiff(result.row),
    );
    reply.header('etag', etag(result.row));
    return { recordType: def.id, record: toView(def, result.row, 'record') };
  });
}

async function restore(c: RecordCall): Promise<{ recordType: string; record: RecordView }> {
  const { h, def, req, reply } = c;
  const { id } = h.params(IdParams);
  const expected = ifMatch(req);
  h.body(RestoreRequest);
  return h.tenant(async (tx, txCtx) => {
    const row = await lockVisible(c, tx, id);
    requireAction(h, def, row, def.access.update);
    if (!row.__archived_at) throw new ApiError('conflict', ['archivedAt']);
    if (row.__v !== expected) throw await versionConflict(tx, def, row, expected);
    await updateColumns(tx, def, id, expected, [
      sql`archived_at = NULL`,
      sql`archived_by = NULL`,
      sql`archive_reason = NULL`,
    ]);
    const after = (await loadRow(tx, def, id)) as Row;
    await appendMutation(h, tx, txCtx, def, 'restore', after, archiveDiff(row), archiveDiff(after));
    reply.header('etag', etag(after));
    return { recordType: def.id, record: toView(def, after, 'record') };
  });
}

/**
 * Bulk (ADR-0014 section 2.5): at most 500 ids; bulk-editable fields or archive only;
 * never approve, reveal, or a transition. Each row is checked on its own (policy,
 * version, rules) in its own savepoint and written with its own audit event carrying
 * `metadata.bulk_id`; refused rows are audited as denied.
 */
async function bulk(c: RecordCall): Promise<BulkResponse> {
  const { h, def } = c;
  const body = h.body(BulkRequest);
  const ids = body.items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) throw new ApiError('bad_request', ['items']);
  if (body.action === 'archive' && !def.actions.includes('archive')) {
    throw new ApiError('bad_request', ['action']);
  }
  const fields =
    body.action === 'update'
      ? (h.body(z.object({ fields: bulkUpdateSchema(def) }).passthrough()).fields as Record<
          string,
          unknown
        >)
      : {};
  const permission = body.action === 'archive' ? def.access.archive : def.access.update;
  if (!h.decide(permission).allowed) throw new DeniedError('permission');
  const bulkId = randomUUID();
  const verb = body.action === 'archive' ? 'archive' : 'update';

  return h.tenant(async (tx, txCtx) => {
    const results: BulkResponse['results'] = [];
    let written = 0;
    const denied: { row: Row; reason: string }[] = [];
    for (const item of body.items) {
      let status: BulkRowStatus = 'invalid';
      let rowVersion: number | undefined;
      let fieldsOut: string[] | undefined;
      try {
        await tx.transaction(async (sp) => {
          const row = await loadRow(sp, def, item.id, true);
          if (!row) {
            status = 'not_found';
            return;
          }
          const visible = decideRecord(h, def.access.read, resourceOf(row), 'any');
          if (!visible.allowed) {
            status = 'not_found';
            denied.push({ row, reason: visible.reason });
            return;
          }
          const allowed = decideRecord(h, permission, resourceOf(row), 'all');
          if (!allowed.allowed) {
            status = 'forbidden';
            denied.push({ row, reason: allowed.reason });
            return;
          }
          if (verb === 'archive') {
            const r = await archiveRow(
              h,
              sp,
              def,
              row,
              item.rowVersion,
              (body as { reason: string }).reason,
            );
            if (r.status !== 'archived') {
              status = r.status;
              if ('fields' in r) fieldsOut = r.fields;
              return;
            }
            await appendMutation(
              h,
              sp,
              txCtx,
              def,
              'archive',
              r.row,
              archiveDiff(row),
              archiveDiff(r.row),
              { bulk_id: bulkId },
            );
            status = 'archived';
            rowVersion = r.row.__v;
            written++;
            return;
          }
          if (row.__archived_at) {
            status = 'archived_already';
            return;
          }
          if (row.__v !== item.rowVersion) {
            status = 'version_conflict';
            return;
          }
          const before = fieldValues(def, row);
          const merged = { ...before, ...fields };
          const bad = [
            ...ruleProblems(def, merged),
            ...((await binding(def).validate?.(sp, merged)) ?? []),
          ];
          if (bad.length > 0) {
            status = 'invalid';
            fieldsOut = bad;
            return;
          }
          const changed = Object.keys(fields).filter((k) => !sameValue(before[k], fields[k]));
          if (changed.length === 0) {
            status = 'updated';
            rowVersion = row.__v;
            return;
          }
          const changes = Object.fromEntries(changed.map((k) => [k, fields[k]]));
          await updateColumns(sp, def, row.__id, item.rowVersion, fieldSets(def, changes));
          const after = (await loadRow(sp, def, row.__id)) as Row;
          const pick = (values: Record<string, unknown>) =>
            toColumns(def, Object.fromEntries(changed.map((k) => [k, values[k]]))) as Diffable;
          await appendMutation(
            h,
            sp,
            txCtx,
            def,
            'update',
            after,
            pick(before),
            pick(fieldValues(def, after)),
            { bulk_id: bulkId },
          );
          status = 'updated';
          rowVersion = after.__v;
          written++;
        });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        // A constraint on one row fails that row only (its savepoint rolled back).
        if (typeof code !== 'string' || !code.startsWith('2')) throw error;
        status = 'invalid';
      }
      results.push({
        id: item.id,
        status,
        ...(rowVersion !== undefined ? { rowVersion } : {}),
        ...(fieldsOut ? { fields: fieldsOut } : {}),
      });
    }
    for (const d of denied) {
      await appendAuditEvent(tx, txCtx, {
        category: 'mutation',
        action: `${def.id}.${verb}` as AuditAction,
        outcome: 'denied',
        targetTable: bareTable(def.table),
        targetId: d.row.__id,
        ...siteOf(d.row),
        metadata: { record_type: def.id, bulk_id: bulkId, reason: d.reason },
        sessionId: h.session().id,
      });
    }
    h.markRecordChecked();
    if (written === 0 && denied.length === 0) h.declareNoChange();
    return { bulkId, results };
  });
}

const HistoryQuery = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

/** History (ADR-0014 section 2.6): the record's events from the audit log, under RLS. */
async function history(c: RecordCall): Promise<HistoryResponse> {
  const { h, def, req } = c;
  const { id } = h.params(IdParams);
  const query = HistoryQuery.safeParse(req.query ?? {});
  if (!query.success) throw new ApiError('bad_request', ['query']);
  const limit = query.data.limit ?? 50;
  return h.tenant(async (tx, txCtx) => {
    const row = await loadRow(tx, def, id);
    if (!row) throw new ApiError('not_found');
    const read = requireVisible(h, def, row);
    if (!historyAllowed(h, def, read)) throw new DeniedError('record_rule', targetOf(def, row));
    const fingerprint = `history:${id}`;
    const before = query.data.cursor
      ? Number(verifyCursor(h, 'history', def.id, fingerprint, query.data.cursor))
      : null;
    const r = await tx.execute<{
      id: string;
      occurred_at: string;
      chain_seq: string;
      category: string;
      action: string;
      outcome: string;
      actor_type: string;
      actor_label: string;
      diff: unknown;
      metadata: Record<string, unknown>;
      reason: string | null;
    }>(sql`
      SELECT e.id::text AS id, ${isoSql(sql`e.occurred_at`)} AS occurred_at,
             e.chain_seq::text AS chain_seq, e.category, e.action,
             e.outcome, e.actor_type, e.actor_label, e.diff, e.metadata, e.reason
      FROM audit.audit_event e
      WHERE e.target_table = ${bareTable(def.table)} AND e.target_id = ${id}::uuid
        ${before !== null && Number.isSafeInteger(before) ? sql`AND e.chain_seq < ${before}` : sql``}
      ORDER BY e.chain_seq DESC
      LIMIT ${limit + 1}`);
    const page = r.rows.slice(0, limit);
    await h.recordView(tx, txCtx, targetOf(def, row));
    const last = page[page.length - 1];
    return {
      recordType: def.id,
      id,
      items: page.map((e) => ({
        id: e.id,
        occurredAt: e.occurred_at,
        category: e.category,
        action: e.action,
        outcome: e.outcome,
        actorType: e.actor_type,
        actorLabel: e.actor_label,
        diff: e.diff ?? null,
        metadata: e.metadata,
        reason: e.reason,
      })),
      nextCursor:
        r.rows.length > limit && last
          ? signCursor(h, 'history', def.id, fingerprint, last.chain_seq)
          : null,
    };
  });
}

function exportCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') return null;
  return value as string | number | boolean;
}

/**
 * Export (ADR-0014 section 2.7): CSV of the current filters and the requested visible
 * columns, after re-authentication. Masked, hidden, and PHI fields are never exported.
 * One `<type>.export` event records the type, filters, columns, row count, and SHA-256.
 * Above 1,000 rows the export becomes a job with a stored file (S5 jobs, S6 evidence
 * store); until then it is refused.
 */
async function exportCsv(c: RecordCall): Promise<string> {
  const { h, def, reply } = c;
  const body = h.body(ExportRequest);
  const parsed = parseListQuery(def, body.query);
  if (!parsed.ok)
    throw new ApiError(
      'bad_request',
      parsed.fields.map((f) => `query.${f}`),
    );
  if (parsed.value.cursor) throw new ApiError('bad_request', ['query.cursor']);
  const columns = body.columns ?? [...def.list.defaultColumns];
  const badColumns = columns.filter(
    (f) => !Object.prototype.hasOwnProperty.call(def.fields, f) || !isListable(def, f),
  );
  if (badColumns.length > 0 || new Set(columns).size !== columns.length || columns.length === 0) {
    throw new ApiError('bad_request', ['columns']);
  }
  archivedAllowed(h, def, parsed.value);
  return h.tenant(async (tx, txCtx) => {
    const q = await applySavedView(tx, h, def, parsed.value, body.query.sort !== undefined);
    const rows = await selectRows(tx, def, {
      where: listWhere(h, def, q),
      sort: q.sort,
      limit: EXPORT_MAX_ROWS + 1,
    });
    if (rows.length > EXPORT_MAX_ROWS) throw new ApiError('payload_too_large');
    assertInScope(h, def, rows);
    const now = h.now().toISOString();
    const filters = q.filters.map(
      (f) => `${f.field} ${f.op} ${Array.isArray(f.value) ? f.value.join('|') : String(f.value)}`,
    );
    const header: (string | null)[][] = [
      ['Deemed Health export', def.noun],
      ['Organization', h.ctx.organizationName],
      ['Exported by', h.session().displayName],
      ['Exported at (UTC)', now],
      ['Filters', filters.length ? filters.join('; ') : 'none'],
      ['Search', q.q ? 'yes' : 'no'],
      ...(isProduction(h.services.dhEnv)
        ? []
        : [['PREVIEW', 'Synthetic data only. Not for real patient or staff information.']]),
      [],
    ];
    const data = rows.map((r) => {
      const v = toView(def, r, 'list').fields;
      return columns.map((f) => exportCell(v[f]));
    });
    const csv = toCsv([
      ...header,
      ['id', ...columns],
      ...data.map((d, i) => [(rows[i] as Row).__id, ...d]),
    ]);
    const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
    const digest = digestOf(h);
    await appendAuditEvent(tx, txCtx, {
      category: 'export',
      action: `${def.id}.export` as AuditAction,
      metadata: {
        record_type: def.id,
        format: 'csv',
        columns,
        row_count: rows.length,
        sha256,
        archived: q.archived,
        // Filter values can be personal data: fields and operators in clear, values as a keyed digest.
        filters: q.filters.map((f) => ({
          field: f.field,
          op: f.op,
          value_hmac_sha256: digest.digest(JSON.stringify(f.value)),
        })),
        ...(q.q ? { search_hmac_sha256: digest.digest(q.q) } : {}),
        digest_key: digest.keyId,
        ...(q.view ? { saved_view_id: q.view } : {}),
      },
      sessionId: h.session().id,
    });
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${def.id}-export.csv"`)
      .header('x-content-sha256', sha256);
    return csv;
  });
}

/**
 * Reveal (ADR-0007, ADR-0014 section 4.5): one masked field of one record, for a role the
 * field names, after step-up (route `recentAuth`), with a reason code; never cached,
 * never in a list. The reason code is the event's reason; a free-text note is logged as
 * its length and a keyed digest only.
 */
async function reveal(c: RecordCall): Promise<{ field: string; value: string | null }> {
  const { h, def, meta } = c;
  const { id } = h.params(IdParams);
  const body = h.body(RevealRequest);
  const name = meta.field as string;
  const f = def.fields[name];
  if (!f?.reveal) throw new ApiError('not_found');
  return h.tenant(async (tx, txCtx) => {
    const row = await loadRow(tx, def, id);
    if (!row) throw new ApiError('not_found');
    requireVisible(h, def, row);
    const d = decideRecord(h, def.access.read, resourceOf(row), 'any', f.reveal?.roles);
    // Visible, but this viewer holds none of the field's reveal roles for the record.
    if (!d.allowed) throw new DeniedError('record_rule', targetOf(def, row));
    const r = await tx.execute<{ v: Buffer | null }>(
      sql`SELECT ${col(f.column)} AS v FROM ${tableRef(def)} t WHERE t.id = ${id}::uuid`,
    );
    const cipher = r.rows[0]?.v ?? null;
    let value: string | null = null;
    if (cipher !== null) {
      const cipherPort = h.services.fieldCipher;
      if (!cipherPort) throw new ApiError('not_configured');
      value = await cipherPort.decrypt(
        {
          organizationId: txCtx.organizationId as string,
          table: def.table,
          column: f.column,
          recordId: id,
        },
        cipher,
      );
    }
    const digest = digestOf(h);
    await appendAuditEvent(tx, txCtx, {
      category: 'reveal',
      action: revealAction(def.id, name) as AuditAction,
      targetTable: bareTable(def.table),
      targetId: id,
      ...siteOf(row),
      reason: body.reasonCode,
      metadata: {
        record_type: def.id,
        field: name,
        value_present: cipher !== null,
        ...(body.note
          ? {
              note_length: [...body.note].length,
              note_hmac_sha256: digest.digest(body.note),
              note_digest_key: digest.keyId,
            }
          : {}),
      },
      sessionId: h.session().id,
    });
    return { field: name, value };
  });
}

const ACTIONS: Record<RecordRouteAction, (c: RecordCall) => Promise<unknown>> = {
  list,
  get,
  create,
  update,
  archive,
  restore,
  bulk,
  history,
  export: exportCsv,
  import: importDryRun,
  reveal,
  ...savedViewHandlers,
};

/** One handler per generated record route (ids from the manifest). */
export function recordHandlers(): Record<RecordRouteId, Handler> {
  const out: Record<RecordRouteId, Handler> = {};
  for (const [id, meta] of Object.entries(RECORD_ROUTE_META) as [
    RecordRouteId,
    RecordRouteMeta,
  ][]) {
    const def = getRecordType(meta.typeId);
    const fn = ACTIONS[meta.action];
    out[id] = (req, reply, h) => withDbErrors(() => fn({ req, reply, h, def, meta }));
  }
  return out;
}
