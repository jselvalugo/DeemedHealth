/**
 * Saved views (ADR-0014 sections 2 and 6): a named list query (filters, sort, search) and
 * columns for one record type, private to its owner or shared with roles.
 *
 *  - A saved view never widens access: it is only a query, evaluated with the viewer's own
 *    permissions and scope, and it cannot filter, sort, or search a restricted field (the
 *    same validation as the query string).
 *  - Sharing with roles changes what others see in their launcher, so it needs the
 *    type's update permission and writes a `permission` event (`saved_view.share`).
 *  - Only the owner changes or removes a view. No personal data in view names (4.5); an
 *    SSN-shaped name is refused (D1).
 *
 * Routes are nested under the record type (`/api/records/<type>/saved-views`) so each
 * gets the type's permission and the generated four-case tests.
 */
import { appendAuditEvent, type TransactionContext, type Tx } from '@deemed/db';
import {
  SavedViewCreate,
  SavedViewUpdate,
  activeRoleIds,
  checkStoredQuery,
  fieldClass,
  isListable,
  containsSsnShape,
  type JsonValue,
  type ListQuery,
  type RecordTypeDef,
  type SavedView,
  type SavedViewListResponse,
  type SavedViewQuery,
} from '@deemed/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { redactedDiff } from '../audit.js';
import type { Helpers } from '../context.js';
import { ApiError, DeniedError } from '../errors.js';
import { digestOf, ifMatch, type RecordCall } from './http.js';

interface ViewRow {
  [column: string]: unknown;
  id: string;
  record_type: string;
  owner_user_account_id: string;
  name: string;
  visibility: 'private' | 'roles';
  shared_roles: string[];
  query: SavedViewQuery;
  columns: string[];
  row_version: number;
  archived_at: Date | null;
}

const ViewParams = z.object({ viewId: z.string().uuid() });

/**
 * The owner sees the whole view. Anyone else sees a shared view's fields and operators
 * only: filter values and search text stay server-side, where applying the view uses
 * them (security review L2).
 */
function toSavedView(h: Helpers, v: ViewRow): SavedView {
  const owned = v.owner_user_account_id === h.session().userAccountId;
  return {
    id: v.id,
    recordType: v.record_type,
    name: v.name,
    visibility: v.visibility,
    sharedRoles: v.shared_roles,
    query: owned
      ? v.query
      : {
          filters: v.query.filters.map((f) => ({ field: f.field, op: f.op })),
          sort: v.query.sort,
        },
    columns: v.columns,
    rowVersion: v.row_version,
    owned,
  };
}

function myRoles(h: Helpers): string[] {
  return activeRoleIds(h.principal(), h.now());
}

/** Views of this type the viewer may use: their own, or shared with one of their roles. */
function visibleSql(h: Helpers, def: RecordTypeDef) {
  return sql`v.record_type = ${def.id} AND v.archived_at IS NULL
    AND (v.owner_user_account_id = ${h.session().userAccountId}::uuid
         OR (v.visibility = 'roles'
             AND v.shared_roles && ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(myRoles(h))}::jsonb))))`;
}

const COLUMNS = sql`v.id::text AS id, v.record_type, v.owner_user_account_id::text AS owner_user_account_id,
  v.name, v.visibility, v.shared_roles, v.query, v.columns, v.row_version, v.archived_at`;

async function findVisible(tx: Tx, h: Helpers, def: RecordTypeDef, id: string, lock = false) {
  const r = await tx.execute<ViewRow>(sql`SELECT ${COLUMNS} FROM public.saved_view v
    WHERE v.id = ${id}::uuid AND ${visibleSql(h, def)} ${lock ? sql`FOR UPDATE` : sql``}`);
  return r.rows[0];
}

/** Applies `view=<id>` to a list query: the view's filters, and its sort unless one was given. */
export async function applySavedView(
  tx: Tx,
  h: Helpers,
  def: RecordTypeDef,
  q: ListQuery,
  sortGiven: boolean,
): Promise<ListQuery> {
  if (!q.view) return q;
  const view = await findVisible(tx, h, def, q.view);
  if (!view) throw new ApiError('not_found');
  const stored = checkStoredQuery(def, view.query);
  if (!stored.ok) throw new ApiError('bad_request', stored.fields);
  return {
    ...q,
    filters: [...stored.value.filters, ...q.filters],
    sort: sortGiven || stored.value.sort.length === 0 ? q.sort : stored.value.sort,
    q: q.q ?? stored.value.q,
  };
}

function checkView(
  h: Helpers,
  def: RecordTypeDef,
  v: {
    name?: string | undefined;
    query?: SavedViewQuery | undefined;
    columns?: readonly string[] | undefined;
  },
): void {
  const bad: string[] = [];
  if (v.name !== undefined && containsSsnShape(v.name)) bad.push('name');
  if (v.query) {
    const stored = checkStoredQuery(def, v.query);
    if (!stored.ok) bad.push(...stored.fields);
  }
  for (const c of v.columns ?? []) {
    if (!Object.prototype.hasOwnProperty.call(def.fields, c) || !isListable(def, c)) {
      bad.push('columns');
      break;
    }
  }
  if (bad.length > 0) throw new ApiError('bad_request', bad);
}

/** Sharing with roles is a policy change: it needs the type's update permission. */
/**
 * A view shared with roles shows its query shape to other people, so it carries no search
 * text and no filter on a personal-data or free-text field (security review L2).
 */
function sharedQueryProblems(def: RecordTypeDef, query: SavedViewQuery): string[] {
  const bad: string[] = [];
  if (query.q) bad.push('query.q');
  for (const f of query.filters) {
    const c = fieldClass(def, f.field);
    if (!c || c.class === 'PII' || c.class === 'PHI' || c.freeText) {
      bad.push(`query.filters.${f.field}`);
    }
  }
  return bad;
}

function checkSharing(
  h: Helpers,
  def: RecordTypeDef,
  visibility: string,
  roles: readonly string[],
  query: SavedViewQuery,
) {
  if (visibility === 'roles') {
    const bad = sharedQueryProblems(def, query);
    if (bad.length > 0) throw new ApiError('bad_request', bad);
  }
  if (visibility === 'roles' && roles.length === 0)
    throw new ApiError('bad_request', ['sharedRoles']);
  if (visibility === 'private' && roles.length > 0)
    throw new ApiError('bad_request', ['sharedRoles']);
  if (visibility === 'roles' && !h.decide(def.access.update).allowed) {
    throw new DeniedError('permission');
  }
}

function auditRow(
  v: Pick<ViewRow, 'record_type' | 'name' | 'visibility' | 'shared_roles' | 'columns'> & {
    query: unknown;
    archived_at?: Date | null;
  },
) {
  return {
    record_type: v.record_type,
    name: v.name,
    visibility: v.visibility,
    shared_roles: v.shared_roles,
    columns: v.columns,
    query: v.query as JsonValue,
    archived_at: v.archived_at ?? null,
  };
}

async function appendViewEvents(
  h: Helpers,
  tx: Tx,
  txCtx: TransactionContext,
  action: 'saved_view.create' | 'saved_view.update',
  id: string,
  before: ReturnType<typeof auditRow> | null,
  after: ReturnType<typeof auditRow>,
) {
  const common = { targetTable: 'saved_view', targetId: id, sessionId: h.session().id };
  await appendAuditEvent(tx, txCtx, {
    category: 'mutation',
    action,
    ...common,
    diff: redactedDiff('public.saved_view', before, after, digestOf(h)),
    metadata: { record_type: after.record_type },
  });
  const shared = after.visibility === 'roles' && after.archived_at === null;
  const changedSharing =
    JSON.stringify([before?.visibility, before?.shared_roles]) !==
    JSON.stringify([after.visibility, after.shared_roles]);
  if (shared && changedSharing) {
    await appendAuditEvent(tx, txCtx, {
      category: 'permission',
      action: 'saved_view.share',
      ...common,
      diff: redactedDiff(
        'public.saved_view',
        before ? { visibility: before.visibility, shared_roles: before.shared_roles } : null,
        { visibility: after.visibility, shared_roles: after.shared_roles },
      ),
      metadata: { record_type: after.record_type },
    });
  }
}

async function listViews(c: RecordCall): Promise<SavedViewListResponse> {
  const { h, def } = c;
  return h.tenant(async (tx) => {
    const r = await tx.execute<ViewRow>(
      sql`SELECT ${COLUMNS} FROM public.saved_view v WHERE ${visibleSql(h, def)} ORDER BY v.name, v.id`,
    );
    return { items: r.rows.map((v) => toSavedView(h, v)) };
  });
}

async function createView(c: RecordCall): Promise<SavedView> {
  const { h, def, reply } = c;
  const body = h.body(SavedViewCreate);
  const roles = body.sharedRoles ?? [];
  checkView(h, def, body);
  checkSharing(h, def, body.visibility, roles, body.query);
  return h.tenant(async (tx, txCtx) => {
    const r = await tx.execute<ViewRow>(sql`
      INSERT INTO public.saved_view AS v
        (organization_id, record_type, owner_user_account_id, name, visibility, shared_roles, query, columns)
      VALUES (${txCtx.organizationId}::uuid, ${def.id}, ${h.session().userAccountId}::uuid, ${body.name},
              ${body.visibility},
              ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(roles)}::jsonb)),
              ${JSON.stringify(body.query)}::jsonb,
              ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(body.columns ?? [])}::jsonb)))
      RETURNING ${COLUMNS}`);
    const view = r.rows[0] as ViewRow;
    await appendViewEvents(h, tx, txCtx, 'saved_view.create', view.id, null, auditRow(view));
    reply.status(201).header('etag', `"${view.row_version}"`);
    return toSavedView(h, view);
  });
}

async function updateView(c: RecordCall): Promise<SavedView> {
  const { h, def, req, reply } = c;
  const { viewId } = h.params(ViewParams);
  const expected = ifMatch(req);
  const body = h.body(SavedViewUpdate);
  checkView(h, def, body);
  return h.tenant(async (tx, txCtx) => {
    const view = await findVisible(tx, h, def, viewId, true);
    if (!view) throw new ApiError('not_found');
    if (view.owner_user_account_id !== h.session().userAccountId) {
      throw new DeniedError('record_rule', { table: 'saved_view', id: view.id });
    }
    h.markRecordChecked();
    if (view.row_version !== expected) throw new ApiError('version_conflict', [], view.row_version);
    const visibility = body.visibility ?? view.visibility;
    const roles = body.sharedRoles ?? (body.visibility === 'private' ? [] : view.shared_roles);
    checkSharing(h, def, visibility, roles, body.query ?? view.query);
    const r = await tx.execute<ViewRow>(sql`
      UPDATE public.saved_view AS v SET
        name = ${body.name ?? view.name},
        visibility = ${visibility},
        shared_roles = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(roles)}::jsonb)),
        query = ${JSON.stringify(body.query ?? view.query)}::jsonb,
        columns = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(body.columns ?? view.columns)}::jsonb)),
        archived_at = ${body.archived ? sql`now()` : sql`NULL`}
      WHERE v.id = ${view.id}::uuid AND v.row_version = ${expected}
      RETURNING ${COLUMNS}`);
    const after = r.rows[0] as ViewRow;
    await appendViewEvents(
      h,
      tx,
      txCtx,
      'saved_view.update',
      view.id,
      auditRow(view),
      auditRow(after),
    );
    reply.header('etag', `"${after.row_version}"`);
    return toSavedView(h, after);
  });
}

export const savedViewHandlers = {
  'views.list': listViews,
  'views.create': createView,
  'views.update': updateView,
} as const;
