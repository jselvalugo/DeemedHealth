/**
 * Route manifest entries generated from the record type registry (ADR-0014 section 2.9):
 * one entry per record type and action, under `/api/records/<type>`. Each entry carries
 * the type's permission for that action, so the S3 middleware checks the role before
 * the handler runs, and each is covered by the generated four-case tests (allowed,
 * denied role, other site, other tenant) in apps/api/test/records.routes.test.ts.
 *
 * There is no DELETE route for any record type: archive and restore only.
 */
import { recordTypes, revealAction, type AuditAction, type RecordTypeDef } from '@deemed/domain';
import type { RouteSpec } from '../manifest.js';

export const RECORD_ROUTE_ACTIONS = [
  'list',
  'get',
  'create',
  'update',
  'archive',
  'restore',
  'bulk',
  'history',
  'export',
  'import',
  'reveal',
  'views.list',
  'views.create',
  'views.update',
] as const;
export type RecordRouteAction = (typeof RECORD_ROUTE_ACTIONS)[number];

export type RecordRouteId = `records.${string}`;

export interface RecordRouteMeta {
  typeId: string;
  action: RecordRouteAction;
  /** Reveal routes: the field. */
  field?: string;
}

function action(name: string): AuditAction {
  return name as AuditAction;
}

function routesFor(def: RecordTypeDef): [RecordRouteId, RouteSpec, RecordRouteMeta][] {
  const base = `/api/records/${def.id}`;
  const a = def.access;
  const has = (x: RecordTypeDef['actions'][number]) => def.actions.includes(x);
  const out: [RecordRouteId, RouteSpec, RecordRouteMeta][] = [];
  const add = (
    act: RecordRouteAction,
    spec: Omit<RouteSpec, 'summary'> & { summary?: string },
    field?: string,
  ) => {
    const id: RecordRouteId = `records.${def.id}.${act}${field ? `.${field}` : ''}`;
    out.push([
      id,
      { summary: `${def.noun}: ${act}${field ? ` ${field}` : ''}`, ...spec },
      { typeId: def.id, action: act, ...(field ? { field } : {}) },
    ]);
  };

  add('list', {
    method: 'GET',
    url: base,
    access: { kind: 'permission', permission: a.read },
    audit: null,
    summary: `List ${def.noun} records (filters, sort, search, keyset cursor, saved view)`,
  });
  add('get', {
    method: 'GET',
    url: `${base}/:id`,
    access: { kind: 'permission', permission: a.read, record: true },
    audit: null,
  });
  if (has('create')) {
    add('create', {
      method: 'POST',
      url: base,
      access: { kind: 'permission', permission: a.create, record: true },
      audit: { action: action(`${def.id}.create`) },
    });
  }
  if (has('update')) {
    add('update', {
      method: 'PATCH',
      url: `${base}/:id`,
      access: { kind: 'permission', permission: a.update, record: true },
      audit: { action: action(`${def.id}.update`) },
      summary: `Change a ${def.noun} (If-Match row version required)`,
    });
  }
  if (has('archive')) {
    add('archive', {
      method: 'POST',
      url: `${base}/:id/archive`,
      access: { kind: 'permission', permission: a.archive, record: true },
      audit: { action: action(`${def.id}.archive`) },
    });
    add('restore', {
      method: 'POST',
      url: `${base}/:id/restore`,
      access: { kind: 'permission', permission: a.update, record: true },
      audit: { action: action(`${def.id}.restore`) },
    });
  }
  if (has('bulk')) {
    add('bulk', {
      method: 'POST',
      url: `${base}/bulk`,
      access: { kind: 'permission', permission: a.update, record: true },
      audit: { action: action(`${def.id}.update`), perRow: true },
      summary: `Bulk change or archive up to 500 ${def.noun} records; one audit event per row`,
    });
  }
  add('history', {
    method: 'GET',
    url: `${base}/:id/history`,
    access: { kind: 'permission', permission: a.read, record: true },
    audit: null,
  });
  if (has('export')) {
    add('export', {
      method: 'POST',
      url: `${base}/exports`,
      access: { kind: 'permission', permission: a.export, recentAuth: true },
      audit: { action: action(`${def.id}.export`) },
      userLimit: 'export',
      summary: `Export ${def.noun} records to CSV (re-authentication, masked fields excluded)`,
    });
  }
  if (has('import')) {
    add('import', {
      method: 'POST',
      url: `${base}/imports`,
      access: { kind: 'permission', permission: a.create },
      audit: null,
      userLimit: 'import',
      writesNothing:
        'import dry run: a row-level report, nothing is written (ADR-0014 section 2.8)',
      summary: `Import dry run for ${def.noun} (feature flag records.import; off in deployed environments until G4)`,
    });
  }
  if (has('reveal')) {
    for (const [name, f] of Object.entries(def.fields)) {
      if (!f.reveal) continue;
      add(
        'reveal',
        {
          method: 'POST',
          url: `${base}/:id/reveal/${name}`,
          access: { kind: 'permission', permission: a.read, recentAuth: true, record: true },
          audit: { action: action(revealAction(def.id, name)) },
          userLimit: 'reveal',
          summary: `Reveal ${def.noun} ${name} (step-up, reason, audited)`,
        },
        name,
      );
    }
  }
  if (has('views')) {
    add('views.list', {
      method: 'GET',
      url: `${base}/saved-views`,
      access: { kind: 'permission', permission: a.read },
      audit: null,
    });
    add('views.create', {
      method: 'POST',
      url: `${base}/saved-views`,
      access: { kind: 'permission', permission: a.read },
      audit: { action: 'saved_view.create' },
    });
    add('views.update', {
      method: 'PATCH',
      url: `${base}/saved-views/:viewId`,
      access: { kind: 'permission', permission: a.read, record: true },
      audit: { action: 'saved_view.update' },
    });
  }
  return out;
}

const ALL = recordTypes().flatMap(routesFor);

export const RECORD_ROUTES: Readonly<Record<RecordRouteId, RouteSpec>> = Object.fromEntries(
  ALL.map(([id, spec]) => [id, spec]),
);

export const RECORD_ROUTE_META: Readonly<Record<RecordRouteId, RecordRouteMeta>> =
  Object.fromEntries(ALL.map(([id, , meta]) => [id, meta]));

export function isRecordRouteId(id: string): id is RecordRouteId {
  return Object.prototype.hasOwnProperty.call(RECORD_ROUTE_META, id);
}
