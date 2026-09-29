/**
 * The synthetic in-memory records adapter for NON-PRODUCTION previews without a
 * database (the Netlify development site). It plays the part of apps/api for the
 * records UI: same query parsing, payload schemas, record rules, permission checks
 * (the domain policy engine), `If-Match` versions and 409s, archive blockers, history
 * events, step-up for reveal, and saved views, over the seeded XYZ data.
 *
 * State is the seed plus a replayed journal of the viewer's own changes (kept in an
 * HttpOnly cookie by the server actions), so it survives serverless restarts and never
 * mixes reviewers. Pure: no Next.js, no I/O, the clock and new ids are passed in.
 */
import {
  ArchiveRequest,
  BulkRequest,
  RestoreRequest,
  RevealRequest,
  SavedViewCreate,
  SavedViewUpdate,
  authorize,
  bulkUpdateSchema,
  checkStoredQuery,
  createSchema,
  getRecordType,
  isHidden,
  isListable,
  isMasked,
  isRecordTypeId,
  issuePaths,
  parseListQuery,
  revealAction,
  ruleProblems,
  updateSchema,
  type BulkResponse,
  type HistoryEvent,
  type HistoryResponse,
  type ListFilter,
  type Permission,
  type RecordGetResponse,
  type RecordListResponse,
  type RecordTypeDef,
  type RecordView,
  type RevealResponse,
  type RoleId,
  type SavedView,
  type SavedViewListResponse,
} from '@deemed/domain';
import type { RecordsResult } from '@deemed/ui';
import { DEMO_ORG_ID, SEED_VIEWS, demoSeed } from './seed';

export type DemoViewer = { id: string; name: string; roles: readonly RoleId[] };

type Row = {
  id: string;
  v: number;
  archivedAt: string | null;
  values: Record<string, unknown>;
  secrets: Record<string, string | null>;
};

type ViewRow = {
  id: string;
  recordType: string;
  owner: string;
  name: string;
  visibility: 'private' | 'roles';
  sharedRoles: string[];
  query: {
    filters: { field: string; op: ListFilter['op']; value: string | string[] }[];
    sort: { field: string; dir: 'asc' | 'desc' }[];
    q?: string | null | undefined;
  };
  columns: string[];
  v: number;
  archived: boolean;
};

export type DemoStore = {
  rows: Record<string, Row[]>;
  events: (HistoryEvent & { type: string; targetId: string; rowVersion: number | null })[];
  views: ViewRow[];
};

/** Operations the UI sends (validated by the server action before they get here). */
export type DemoOp =
  | { op: 'list'; type: string; query: Record<string, string> }
  | { op: 'get'; type: string; id: string }
  | { op: 'create'; type: string; fields: Record<string, unknown> }
  | { op: 'update'; type: string; id: string; version: number; fields: Record<string, unknown> }
  | { op: 'archive'; type: string; id: string; version: number; body: unknown }
  | { op: 'restore'; type: string; id: string; version: number; body: unknown }
  | { op: 'bulk'; type: string; body: unknown }
  | { op: 'history'; type: string; id: string; cursor: string | null }
  | { op: 'reveal'; type: string; id: string; field: string; body: unknown }
  | { op: 'views.list'; type: string }
  | { op: 'views.create'; type: string; body: unknown }
  | { op: 'views.update'; type: string; viewId: string; version: number; body: unknown };

export const MUTATING_OPS: readonly DemoOp['op'][] = [
  'create',
  'update',
  'archive',
  'restore',
  'bulk',
  'reveal',
  'views.create',
  'views.update',
];

export type RunContext = {
  viewer: DemoViewer;
  /** ISO time of the operation. */
  now: string;
  /** Fresh UUIDs the operation may use (recorded in the journal for replay). */
  ids: readonly string[];
  /** When the viewer last confirmed it's them (epoch ms), for reveal. */
  stepUpAt: number | null;
};

export const STEP_UP_MS = 5 * 60 * 1000;

/**
 * Whether a step-up at `stepUpAt` still counts at `at` (both epoch ms). Written as the
 * failure conditions, so a missing or non-finite value (NaN compares false) fails closed.
 */
export function stepUpFresh(stepUpAt: number | null | undefined, at: number): boolean {
  if (stepUpAt === null || stepUpAt === undefined) return false;
  if (!Number.isFinite(stepUpAt) || !Number.isFinite(at)) return false;
  if (at - stepUpAt > STEP_UP_MS) return false;
  if (stepUpAt > at + 60_000) return false;
  return true;
}
const HISTORY_PAGE = 50;

type Result<T> = RecordsResult<T>;
const fail = <T>(
  status: number,
  code: Parameters<typeof errorOf>[0],
  fields?: string[],
  currentVersion?: number,
): Result<T> => errorOf(code, status, fields, currentVersion);

function errorOf(
  code:
    | 'bad_request'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'version_conflict'
    | 'reauth_required'
    | 'unauthenticated',
  status: number,
  fields?: string[],
  currentVersion?: number,
): { ok: false; status: number; code: typeof code; fields?: string[]; currentVersion?: number } {
  return {
    ok: false,
    status,
    code,
    ...(fields && fields.length ? { fields } : {}),
    ...(currentVersion !== undefined ? { currentVersion } : {}),
  };
}

export function seedStore(): DemoStore {
  const seed = demoSeed();
  const rows: Record<string, Row[]> = {};
  const events: DemoStore['events'] = [];
  let n = 0;
  for (const [type, list] of Object.entries(seed)) {
    const def = getRecordType(type);
    rows[type] = list.map((r) => {
      const values = { ...r.values };
      events.push({
        id: `d0000001-00ee-4000-8000-${(++n).toString(16).padStart(12, '0')}`,
        type,
        targetId: r.id,
        rowVersion: 1,
        occurredAt: (values.createdAt as string) ?? '2026-01-05T14:00:00.000Z',
        category: 'mutation',
        action: `${type}.create`,
        outcome: 'success',
        actorType: 'system',
        actorLabel: 'Synthetic data seed',
        diff: {
          fields: Object.fromEntries(
            Object.keys(values).map((f) => [def.fields[f]?.column ?? f, { changed: true }]),
          ),
        },
        metadata: { record_type: type, row_version: 1 },
        reason: null,
      });
      return {
        id: r.id,
        v: 1,
        archivedAt: r.archivedAt ?? null,
        values,
        secrets: { ...r.secrets },
      };
    });
  }
  const views: ViewRow[] = SEED_VIEWS.map((v) => ({
    ...v,
    sharedRoles: [...v.sharedRoles],
    query: {
      filters: v.query.filters.map((f) => ({ ...f })),
      sort: v.query.sort.map((s) => ({ ...s })),
      q: v.query.q,
    },
    columns: [...v.columns],
    v: 1,
    archived: false,
  }));
  return { rows, events, views };
}

// ---------------------------------------------------------------------------
// Policy (the domain engine, with the demo user's organization-wide grants)
// ---------------------------------------------------------------------------

function can(viewer: DemoViewer, permission: Permission, now: string): boolean {
  const principal = {
    organizationId: DEMO_ORG_ID,
    userAccountId: viewer.id,
    personId: viewer.id,
    grants: viewer.roles.map((roleId, i) => ({
      id: `demo-grant-${i}`,
      roleId,
      siteId: null,
      validFrom: new Date(0),
      expiresAt: null,
    })),
  };
  return authorize(
    principal,
    permission,
    { organizationId: DEMO_ORG_ID, siteId: null },
    { now: new Date(now), approvalAreas: {} },
  ).allowed;
}

function viewOf(def: RecordTypeDef, row: Row, mode: 'list' | 'record'): RecordView {
  const fields: RecordView['fields'] = {};
  for (const name of Object.keys(def.fields)) {
    if (isHidden(def, name)) continue;
    if (isMasked(def, name)) {
      if (mode === 'record') fields[name] = { masked: true, hasValue: row.secrets[name] != null };
      continue;
    }
    if (mode === 'list' && def.fields[name]?.detailOnly) continue;
    fields[name] = (row.values[name] ?? null) as RecordView['fields'][string];
  }
  return {
    id: row.id,
    rowVersion: def.versioned ? row.v : null,
    archivedAt: row.archivedAt,
    fields,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function lower(v: unknown): string {
  return typeof v === 'string' ? v.toLocaleLowerCase('en-US') : String(v ?? '');
}

function matches(def: RecordTypeDef, row: Row, f: ListFilter): boolean {
  const kind = def.fields[f.field]?.kind;
  const raw = row.values[f.field];
  const v = kind === 'boolean' && typeof raw === 'boolean' ? String(raw) : raw;
  const num = (x: unknown) => (kind === 'integer' ? Number(x) : x);
  switch (f.op) {
    case 'is_null':
      return (v === null || v === undefined) === f.value;
    case 'eq':
      return v !== null && v !== undefined && String(v) === f.value;
    case 'in':
      return v !== null && v !== undefined && (f.value as readonly string[]).includes(String(v));
    case 'contains':
      return typeof v === 'string' && lower(v).includes(lower(f.value));
    case 'between': {
      const [lo, hi] = f.value as readonly string[];
      return v != null && cmp(num(v), num(lo)) >= 0 && cmp(num(v), num(hi)) <= 0;
    }
    default: {
      if (v === null || v === undefined) return false;
      const c = cmp(num(v), num(f.value));
      return f.op === 'lt' ? c < 0 : f.op === 'lte' ? c <= 0 : f.op === 'gt' ? c > 0 : c >= 0;
    }
  }
}

function list(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  raw: Record<string, string>,
): Result<RecordListResponse> {
  const parsed = parseListQuery(def, raw);
  if (!parsed.ok) return fail(400, 'bad_request', parsed.fields);
  const q = parsed.value;
  if (q.archived !== 'exclude' && !can(ctx.viewer, def.access.update, ctx.now))
    return fail(403, 'forbidden');
  let filters = q.filters;
  let sort = q.sort;
  let search = q.q;
  if (q.view) {
    const view = visibleViews(store, def, ctx.viewer).find((v) => v.id === q.view);
    if (!view) return fail(404, 'not_found');
    const stored = checkStoredQuery(def, view.query);
    if (!stored.ok) return fail(400, 'bad_request', stored.fields);
    filters = [...stored.value.filters, ...filters];
    if (raw.sort === undefined && stored.value.sort.length > 0) sort = stored.value.sort;
    search = search ?? stored.value.q;
  }
  const searchable = Object.entries(def.fields).filter(
    ([n, f]) => f.searchable && isListable(def, n),
  );
  let rows = (store.rows[def.id] ?? []).filter((r) =>
    q.archived === 'exclude' ? !r.archivedAt : q.archived === 'only' ? !!r.archivedAt : true,
  );
  rows = rows.filter((r) => filters.every((f) => matches(def, r, f)));
  if (search) {
    const needle = lower(search);
    rows = rows.filter((r) =>
      searchable.some(([n, f]) => {
        const v = r.values[n];
        if (typeof v !== 'string') return false;
        return f.searchable === 'text' ? lower(v).includes(needle) : lower(v) === needle;
      }),
    );
  }
  const keys = [...sort, { field: 'id', dir: 'asc' as const }];
  rows = [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = k.field === 'id' ? a.id : a.values[k.field];
      const y = k.field === 'id' ? b.id : b.values[k.field];
      // PostgreSQL order: NULLS LAST ascending, NULLS FIRST descending.
      if (x == null || y == null) {
        if (x == null && y == null) continue;
        const nullFirst = x == null ? 1 : -1;
        return k.dir === 'asc' ? nullFirst : -nullFirst;
      }
      const c = cmp(x, y);
      if (c !== 0) return k.dir === 'asc' ? c : -c;
    }
    return 0;
  });
  let offset = 0;
  if (q.cursor) {
    const n = q.cursor.startsWith('o') ? Number(q.cursor.slice(1)) : NaN;
    if (!Number.isSafeInteger(n) || n < 0) return fail(400, 'bad_request', ['cursor']);
    offset = n;
  }
  const page = rows.slice(offset, offset + q.limit);
  return {
    ok: true,
    data: {
      recordType: def.id,
      items: page.map((r) => viewOf(def, r, 'list')),
      nextCursor: offset + q.limit < rows.length ? `o${offset + q.limit}` : null,
      total: rows.length,
      limit: q.limit,
    },
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function find(store: DemoStore, def: RecordTypeDef, id: string): Row | undefined {
  return store.rows[def.id]?.find((r) => r.id === id);
}

function allowedActions(
  def: RecordTypeDef,
  row: Row,
  ctx: RunContext,
): RecordGetResponse['allowedActions'] {
  const out: RecordGetResponse['allowedActions'] = [];
  const archived = row.archivedAt !== null;
  const ok = (p: Permission) => can(ctx.viewer, p, ctx.now);
  if (def.actions.includes('update') && !archived && ok(def.access.update)) out.push('update');
  if (def.actions.includes('archive') && !archived && ok(def.access.archive)) out.push('archive');
  if (def.actions.includes('restore') && archived && ok(def.access.update)) out.push('restore');
  if (ok(def.access.read)) out.push('history');
  return out;
}

function revealable(def: RecordTypeDef, ctx: RunContext): string[] {
  if (!def.actions.includes('reveal') || !can(ctx.viewer, def.access.read, ctx.now)) return [];
  return Object.entries(def.fields)
    .filter(([, f]) => f.reveal?.roles.some((r) => ctx.viewer.roles.includes(r)))
    .map(([n]) => n);
}

function columnDiff(def: RecordTypeDef, names: readonly string[]) {
  return {
    fields: Object.fromEntries(names.map((n) => [def.fields[n]?.column ?? n, { changed: true }])),
  };
}

function addEvent(
  store: DemoStore,
  def: RecordTypeDef,
  row: Row,
  ctx: RunContext,
  verb: string,
  fields: readonly string[],
  extra: Partial<HistoryEvent> = {},
): void {
  store.events.push({
    id: ctx.ids[ctx.ids.length - 1] ?? `${row.id}-${store.events.length}`,
    type: def.id,
    targetId: row.id,
    rowVersion: row.v,
    occurredAt: ctx.now,
    category: 'mutation',
    action: `${def.id}.${verb}`,
    outcome: 'success',
    actorType: 'user',
    actorLabel: ctx.viewer.name,
    diff: fields.length ? columnDiff(def, fields) : null,
    metadata: { record_type: def.id, row_version: row.v },
    reason: null,
    ...extra,
  });
}

function versionConflict<T>(
  store: DemoStore,
  def: RecordTypeDef,
  row: Row,
  expected: number,
): Result<T> {
  const byColumn = new Map(Object.entries(def.fields).map(([n, f]) => [f.column, n]));
  const changed = new Set<string>();
  for (const e of store.events) {
    if (e.type !== def.id || e.targetId !== row.id || (e.rowVersion ?? 0) <= expected) continue;
    const cols =
      e.diff && typeof e.diff === 'object'
        ? Object.keys((e.diff as { fields?: object }).fields ?? {})
        : [];
    for (const c of cols) {
      const n = byColumn.get(c) ?? (c === 'archived_at' ? 'archivedAt' : undefined);
      if (n && (n === 'archivedAt' || isListable(def, n))) changed.add(n);
    }
  }
  return fail(409, 'version_conflict', [...changed].sort(), row.v);
}

const BLOCKERS: Record<string, (store: DemoStore, row: Row) => boolean> = {
  active_user_account: (s, row) =>
    (s.rows.user_account ?? []).some(
      (u) => u.values.personId === row.id && !u.archivedAt && u.values.status !== 'deprovisioned',
    ),
  active_role_assignment: (s, row) =>
    (s.rows.role_assignment ?? []).some((a) => a.values.siteId === row.id && !a.values.revokedAt),
  active_requirement_instance: (s, row) =>
    (s.rows.requirement_instance ?? []).some((r) => r.values.siteId === row.id && !r.archivedAt),
};

function blockers(store: DemoStore, def: RecordTypeDef, row: Row): string[] {
  return (def.archiveBlockedBy ?? [])
    .filter((b) => BLOCKERS[b]?.(store, row))
    .map((b) => `blockedBy.${b}`);
}

function create(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  fields: Record<string, unknown>,
): Result<{ recordType: string; record: RecordView }> {
  const parsed = createSchema(def).safeParse(fields);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const bad = ruleProblems(def, parsed.data as Record<string, unknown>);
  if (bad.length) return fail(400, 'bad_request', bad);
  const id = ctx.ids[0];
  if (!id) return fail(400, 'bad_request');
  const values: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(def.fields)) values[name] = f.nullable ? null : undefined;
  Object.assign(values, parsed.data);
  if (def.lifecycle && values[def.lifecycle.field] === undefined)
    values[def.lifecycle.field] = def.lifecycle.initial;
  if ('state' in def.fields) values.state = 'FL';
  if ('isTestRecord' in def.fields) values.isTestRecord = true;
  if ('createdAt' in def.fields) values.createdAt = ctx.now;
  if ('updatedAt' in def.fields) values.updatedAt = ctx.now;
  const row: Row = { id, v: 1, archivedAt: null, values, secrets: {} };
  (store.rows[def.id] ??= []).push(row);
  addEvent(
    store,
    def,
    row,
    { ...ctx, ids: [ctx.ids[1] ?? `${id}-e`] },
    'create',
    Object.keys(parsed.data as object),
  );
  return { ok: true, data: { recordType: def.id, record: viewOf(def, row, 'record') } };
}

function applyUpdate(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  row: Row,
  patch: Record<string, unknown>,
): string[] {
  const changed = Object.keys(patch).filter(
    (k) => JSON.stringify(row.values[k] ?? null) !== JSON.stringify(patch[k] ?? null),
  );
  if (changed.length === 0) return [];
  for (const k of changed) row.values[k] = patch[k];
  row.v++;
  if ('updatedAt' in def.fields) row.values.updatedAt = ctx.now;
  addEvent(store, def, row, ctx, 'update', changed);
  return changed;
}

function update(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  id: string,
  version: number,
  fields: Record<string, unknown>,
): Result<{ recordType: string; record: RecordView }> {
  const row = find(store, def, id);
  if (!row) return fail(404, 'not_found');
  if (row.v !== version) return versionConflict(store, def, row, version);
  if (row.archivedAt) return fail(409, 'conflict', ['archivedAt']);
  const parsed = updateSchema(def).safeParse(fields);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const bad = ruleProblems(def, { ...row.values, ...(parsed.data as object) });
  if (bad.length) return fail(400, 'bad_request', bad);
  applyUpdate(store, def, ctx, row, parsed.data as Record<string, unknown>);
  return { ok: true, data: { recordType: def.id, record: viewOf(def, row, 'record') } };
}

function archiveRow(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  row: Row,
  reason: string,
): 'archived' | 'archived_already' | 'blocked' {
  if (row.archivedAt) return 'archived_already';
  if (blockers(store, def, row).length) return 'blocked';
  row.archivedAt = ctx.now;
  row.v++;
  // The reason is kept on the row; the audit log (and so history) holds only its length.
  addEvent(store, def, row, ctx, 'archive', [], {
    diff: { fields: { archived_at: { changed: true } } },
    metadata: { record_type: def.id, row_version: row.v, reason_length: [...reason].length },
  });
  return 'archived';
}

function archive(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  id: string,
  version: number,
  body: unknown,
): Result<{ recordType: string; record: RecordView }> {
  const parsed = ArchiveRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const row = find(store, def, id);
  if (!row) return fail(404, 'not_found');
  if (row.v !== version) return versionConflict(store, def, row, version);
  const b = blockers(store, def, row);
  const result = archiveRow(store, def, ctx, row, parsed.data.reason);
  if (result === 'archived_already') return fail(409, 'conflict', ['archivedAt']);
  if (result === 'blocked') return fail(409, 'conflict', b);
  return { ok: true, data: { recordType: def.id, record: viewOf(def, row, 'record') } };
}

function restore(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  id: string,
  version: number,
  body: unknown,
): Result<{ recordType: string; record: RecordView }> {
  const parsed = RestoreRequest.safeParse(body ?? {});
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const row = find(store, def, id);
  if (!row) return fail(404, 'not_found');
  if (row.v !== version) return versionConflict(store, def, row, version);
  if (!row.archivedAt) return fail(409, 'conflict', ['archivedAt']);
  row.archivedAt = null;
  row.v++;
  addEvent(store, def, row, ctx, 'restore', [], {
    diff: { fields: { archived_at: { changed: true } } },
    metadata: {
      record_type: def.id,
      row_version: row.v,
      ...(parsed.data.reason ? { reason_length: [...parsed.data.reason].length } : {}),
    },
  });
  return { ok: true, data: { recordType: def.id, record: viewOf(def, row, 'record') } };
}

function bulk(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  body: unknown,
): Result<BulkResponse> {
  const parsed = BulkRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const req = parsed.data;
  if (new Set(req.items.map((i) => i.id)).size !== req.items.length)
    return fail(400, 'bad_request', ['items']);
  if (req.action === 'archive' && !can(ctx.viewer, def.access.archive, ctx.now))
    return fail(403, 'forbidden');
  let fields: Record<string, unknown> = {};
  if (req.action === 'update') {
    const p = bulkUpdateSchema(def).safeParse(req.fields);
    if (!p.success)
      return fail(
        400,
        'bad_request',
        issuePaths(p.error).map((x) => `fields.${x}`),
      );
    fields = p.data as Record<string, unknown>;
  }
  const bulkId = ctx.ids[0] ?? 'bulk';
  const results: BulkResponse['results'] = req.items.map((item, i) => {
    const row = find(store, def, item.id);
    const rowCtx = { ...ctx, ids: [ctx.ids[i + 1] ?? `${bulkId}-${i}`] };
    if (!row) return { id: item.id, status: 'not_found' as const };
    if (row.v !== item.rowVersion)
      return { id: item.id, status: 'version_conflict' as const, rowVersion: row.v };
    if (req.action === 'archive') {
      const r = archiveRow(store, def, rowCtx, row, req.reason);
      return { id: item.id, status: r, rowVersion: row.v };
    }
    if (row.archivedAt) return { id: item.id, status: 'archived_already' as const };
    const bad = ruleProblems(def, { ...row.values, ...fields });
    if (bad.length) return { id: item.id, status: 'invalid' as const, fields: bad };
    applyUpdate(store, def, rowCtx, row, fields);
    return { id: item.id, status: 'updated' as const, rowVersion: row.v };
  });
  return { ok: true, data: { bulkId, results } };
}

function history(
  store: DemoStore,
  def: RecordTypeDef,
  id: string,
  cursor: string | null,
): Result<HistoryResponse> {
  if (!find(store, def, id)) return fail(404, 'not_found');
  const all = store.events
    .filter((e) => e.type === def.id && e.targetId === id && e.outcome === 'success')
    .filter((e) => (def.history.categories as readonly string[]).includes(e.category))
    .reverse();
  const offset = cursor && cursor.startsWith('o') ? Number(cursor.slice(1)) || 0 : 0;
  const page = all.slice(offset, offset + HISTORY_PAGE);
  return {
    ok: true,
    data: {
      recordType: def.id,
      id,
      items: page.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt,
        category: e.category,
        action: e.action,
        outcome: e.outcome,
        actorType: e.actorType,
        actorLabel: e.actorLabel,
        diff: e.diff,
        metadata: e.metadata,
        reason: e.reason,
      })),
      nextCursor: offset + HISTORY_PAGE < all.length ? `o${offset + HISTORY_PAGE}` : null,
    },
  };
}

function reveal(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  id: string,
  field: string,
  body: unknown,
): Result<RevealResponse> {
  const f = def.fields[field];
  if (!f?.reveal || !def.actions.includes('reveal')) return fail(404, 'not_found');
  const parsed = RevealRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const row = find(store, def, id);
  if (!row) return fail(404, 'not_found');
  if (!revealable(def, ctx).includes(field)) return fail(403, 'forbidden');
  // Step-up (ADR-0006 rule 5): a confirmation within the last five minutes.
  if (!stepUpFresh(ctx.stepUpAt, Date.parse(ctx.now))) return fail(401, 'reauth_required');
  const value = row.secrets[field] ?? null;
  store.events.push({
    id: ctx.ids[0] ?? `${row.id}-r${store.events.length}`,
    type: def.id,
    targetId: row.id,
    rowVersion: null,
    occurredAt: ctx.now,
    category: 'reveal',
    action: revealAction(def.id, field),
    outcome: 'success',
    actorType: 'user',
    actorLabel: ctx.viewer.name,
    diff: null,
    metadata: { record_type: def.id, field, value_present: value !== null },
    reason: parsed.data.reasonCode,
  });
  return { ok: true, data: { field, value } };
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

function visibleViews(store: DemoStore, def: RecordTypeDef, viewer: DemoViewer): ViewRow[] {
  return store.views.filter(
    (v) =>
      v.recordType === def.id &&
      !v.archived &&
      (v.owner === viewer.id ||
        (v.visibility === 'roles' &&
          v.sharedRoles.some((r) => viewer.roles.includes(r as RoleId)))),
  );
}

function toSavedView(v: ViewRow, viewer: DemoViewer): SavedView {
  const owned = v.owner === viewer.id;
  return {
    id: v.id,
    recordType: v.recordType,
    name: v.name,
    visibility: v.visibility,
    sharedRoles: v.sharedRoles,
    // Someone else's view: fields and operators only (no values, no search text).
    query: owned
      ? { filters: v.query.filters, sort: v.query.sort, q: v.query.q ?? null }
      : {
          filters: v.query.filters.map((f) => ({ field: f.field, op: f.op })),
          sort: v.query.sort,
          q: null,
        },
    columns: v.columns,
    rowVersion: v.v,
    owned,
  };
}

function checkView(
  def: RecordTypeDef,
  query: ViewRow['query'] | undefined,
  columns: readonly string[] | undefined,
): string[] {
  const bad: string[] = [];
  if (query) {
    const stored = checkStoredQuery(def, query);
    if (!stored.ok) bad.push(...stored.fields);
  }
  if ((columns ?? []).some((c) => !isListable(def, c))) bad.push('columns');
  return bad;
}

function createView(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  body: unknown,
): Result<SavedView> {
  const parsed = SavedViewCreate.safeParse(body);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const b = parsed.data;
  const roles = b.sharedRoles ?? [];
  if ((b.visibility === 'roles') !== roles.length > 0)
    return fail(400, 'bad_request', ['sharedRoles']);
  if (b.visibility === 'roles' && !can(ctx.viewer, def.access.update, ctx.now))
    return fail(403, 'forbidden');
  const bad = checkView(def, b.query as ViewRow['query'], b.columns);
  if (bad.length) return fail(400, 'bad_request', bad);
  const view: ViewRow = {
    id: ctx.ids[0] ?? 'view',
    recordType: def.id,
    owner: ctx.viewer.id,
    name: b.name,
    visibility: b.visibility,
    sharedRoles: [...roles],
    query: b.query as ViewRow['query'],
    columns: b.columns ?? [...def.list.defaultColumns],
    v: 1,
    archived: false,
  };
  store.views.push(view);
  return { ok: true, data: toSavedView(view, ctx.viewer) };
}

function updateView(
  store: DemoStore,
  def: RecordTypeDef,
  ctx: RunContext,
  viewId: string,
  version: number,
  body: unknown,
): Result<SavedView> {
  const parsed = SavedViewUpdate.safeParse(body);
  if (!parsed.success) return fail(400, 'bad_request', issuePaths(parsed.error));
  const view = visibleViews(store, def, ctx.viewer).find((v) => v.id === viewId);
  if (!view) return fail(404, 'not_found');
  if (view.owner !== ctx.viewer.id) return fail(403, 'forbidden');
  if (view.v !== version) return fail(409, 'version_conflict', [], view.v);
  const b = parsed.data;
  const visibility = b.visibility ?? view.visibility;
  const roles = b.sharedRoles ?? (b.visibility === 'private' ? [] : view.sharedRoles);
  if ((visibility === 'roles') !== roles.length > 0)
    return fail(400, 'bad_request', ['sharedRoles']);
  if (visibility === 'roles' && !can(ctx.viewer, def.access.update, ctx.now))
    return fail(403, 'forbidden');
  const bad = checkView(def, b.query as ViewRow['query'] | undefined, b.columns);
  if (bad.length) return fail(400, 'bad_request', bad);
  Object.assign(view, {
    ...(b.name ? { name: b.name } : {}),
    visibility,
    sharedRoles: [...roles],
    ...(b.query ? { query: b.query } : {}),
    ...(b.columns ? { columns: b.columns } : {}),
    ...(b.archived ? { archived: true } : {}),
    v: view.v + 1,
  });
  return { ok: true, data: toSavedView(view, ctx.viewer) };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** The permission each operation needs (the API's route manifest, in short). */
function permissionFor(def: RecordTypeDef, op: DemoOp['op']): Permission {
  switch (op) {
    case 'create':
      return def.access.create;
    case 'update':
    case 'restore':
    case 'bulk':
      return def.access.update;
    case 'archive':
      return def.access.archive;
    default:
      return def.access.read;
  }
}

const ACTION_OF: Partial<Record<DemoOp['op'], RecordTypeDef['actions'][number]>> = {
  create: 'create',
  update: 'update',
  archive: 'archive',
  restore: 'restore',
  bulk: 'bulk',
  reveal: 'reveal',
  'views.list': 'views',
  'views.create': 'views',
  'views.update': 'views',
};

export function runOp(store: DemoStore, op: DemoOp, ctx: RunContext): Result<unknown> {
  if (!isRecordTypeId(op.type)) return fail(404, 'not_found');
  const def = getRecordType(op.type);
  const action = ACTION_OF[op.op];
  // No route for an action the type does not serve (as in the API's manifest).
  if (action && !def.actions.includes(action)) return fail(404, 'not_found');
  if (!can(ctx.viewer, permissionFor(def, op.op), ctx.now)) return fail(403, 'forbidden');
  switch (op.op) {
    case 'list':
      return list(store, def, ctx, op.query);
    case 'get': {
      const row = find(store, def, op.id);
      if (!row) return fail(404, 'not_found');
      return {
        ok: true,
        data: {
          recordType: def.id,
          record: viewOf(def, row, 'record'),
          allowedActions: allowedActions(def, row, ctx),
          revealable: revealable(def, ctx),
        } satisfies RecordGetResponse,
      };
    }
    case 'create':
      return create(store, def, ctx, op.fields);
    case 'update':
      return update(store, def, ctx, op.id, op.version, op.fields);
    case 'archive':
      return archive(store, def, ctx, op.id, op.version, op.body);
    case 'restore':
      return restore(store, def, ctx, op.id, op.version, op.body);
    case 'bulk':
      return bulk(store, def, ctx, op.body);
    case 'history':
      return history(store, def, op.id, op.cursor);
    case 'reveal':
      return reveal(store, def, ctx, op.id, op.field, op.body);
    case 'views.list':
      return {
        ok: true,
        data: {
          items: visibleViews(store, def, ctx.viewer).map((v) => toSavedView(v, ctx.viewer)),
        } satisfies SavedViewListResponse,
      };
    case 'views.create':
      return createView(store, def, ctx, op.body);
    case 'views.update':
      return updateView(store, def, ctx, op.viewId, op.version, op.body);
  }
}
