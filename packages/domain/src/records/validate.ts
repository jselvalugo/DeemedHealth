/**
 * Registry rules (ADR-0014 section 1, "What each type declares, and the rules on it").
 * `validateRecordType` returns every problem with a type; the registry test fails on
 * any. Pure: it reads the generated column classes, never the database. The index
 * check for sortable and filterable fields runs against pg_indexes in the db tests, and
 * the fixture factory check in packages/test-fixtures.
 */
import { MODULE_IDS } from '../modules.js';
import { ROLE_IDS, type Permission, type PermissionVerb } from '../permissions.js';
import { isSnakeKey } from '../policy/approval-areas.js';
import { RequirementId } from '../primitives.js';
import { classifySsnColumnName } from '../ssn-detector.js';
import { COLUMN_CLASSES, isRestricted, type ColumnClass } from './classes.js';
import {
  ARCHIVE_BLOCKERS,
  DETAIL_TABS,
  FIELD_KINDS,
  HISTORY_CATEGORIES,
  RECORD_ACTIONS,
  RECORD_RULES,
  SITE_SCOPE_JOINS,
  WRITE_ACTIONS,
  type AccessDecl,
  type RecordTypeDef,
} from './define.js';

/** camelCase field name: a lowercase letter, then letters and digits. Checked with a loop. */
export function isFieldName(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const lower = c >= 97 && c <= 122;
    const upper = c >= 65 && c <= 90;
    const digit = c >= 48 && c <= 57;
    if (i === 0 ? !lower : !(lower || upper || digit)) return false;
  }
  return true;
}

/** '' (module root) or lowercase words joined by single dashes. */
export function isSlug(value: string): boolean {
  if (value === '') return true;
  if (value.length > 64 || value.startsWith('-') || value.endsWith('-')) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
    if (!ok) return false;
    if (c === 45 && value.charCodeAt(i - 1) === 45) return false;
  }
  return true;
}

const ACCESS_VERBS: Record<keyof Omit<AccessDecl, 'recordRules'>, readonly PermissionVerb[]> = {
  read: ['read', 'read_own'],
  create: ['write'],
  update: ['write'],
  archive: ['write'],
  export: ['export'],
  approve: ['approve'],
};

export function validateRecordType(def: RecordTypeDef): string[] {
  const problems: string[] = [];
  const p = (m: string) => problems.push(`${def.id}: ${m}`);

  if (!isSnakeKey(def.id, 64)) p('id must be snake_case');
  if (!(MODULE_IDS as readonly string[]).includes(def.module)) p(`unknown module ${def.module}`);
  if (!isSlug(def.slug)) p(`slug "${def.slug}" is not a route segment`);
  if (def.noun.trim() === '') p('noun is required');

  const table = COLUMN_CLASSES[def.table];
  if (!table) p(`table ${def.table} is not in the data dictionary`);
  // Only read-only types (catalog entries, ADR-0014 section 4.2) may be global.
  else if (table.scope !== 'tenant' && !def.readOnly) {
    p(`table ${def.table} has scope ${table.scope}; only read-only types may be non-tenant`);
  }
  const classOf = (column: string): ColumnClass | undefined => table?.columns[column];

  // Fields
  const schemaKeys = new Set(Object.keys(def.schema.shape));
  const columns = new Set<string>();
  const fields = def.fields;
  const has = (a: RecordTypeDef['actions'][number]) => def.actions.includes(a);
  let revealable = 0;
  for (const [name, f] of Object.entries(fields)) {
    const where = `field ${name}`;
    if (!isFieldName(name)) p(`${where}: name must be camelCase`);
    if (classifySsnColumnName(name) || classifySsnColumnName(f.column)) {
      p(`${where}: looks like an SSN field (decision D1)`);
    }
    if (columns.has(f.column)) p(`${where}: column ${f.column} is bound twice`);
    columns.add(f.column);
    if (!(FIELD_KINDS as readonly string[]).includes(f.kind)) p(`${where}: unknown kind`);
    if (f.kind === 'enum' && (!f.values || f.values.length === 0)) {
      p(`${where}: enum without values`);
    }
    const cls = classOf(f.column);
    if (!cls) {
      p(`${where}: column ${def.table}.${f.column} has no sensitivity class`);
      continue;
    }
    const restricted = isRestricted(cls);
    if (restricted) {
      const why = `${where} is ${cls.class === 'PHI' ? 'PHI' : cls.display}`;
      if (f.searchable) p(`${why} and cannot be searchable`);
      if (f.filterable) p(`${why} and cannot be filterable`);
      if (f.sortable) p(`${why} and cannot be sortable`);
      if (f.bulkEditable) p(`${why} and cannot be bulk-editable`);
      if (f.importable) p(`${why} and cannot be importable`);
      if (f.editable) p(`${why} and cannot be edited through the generic API until S6`);
      if ((def.list.defaultColumns as readonly string[]).includes(name)) {
        p(`${why} and cannot be a default list column`);
      }
    }
    if (f.reveal) {
      revealable++;
      if (cls.display !== 'masked') p(`${where}: only masked fields can be revealed`);
      if (f.reveal.roles.length === 0) p(`${where}: reveal needs at least one role`);
      for (const r of f.reveal.roles) {
        if (!(ROLE_IDS as readonly string[]).includes(r)) p(`${where}: unknown reveal role ${r}`);
      }
      if (f.reveal.stepUp !== true) p(`${where}: reveal always needs step-up`);
    }
    if (f.editable && !schemaKeys.has(name)) p(`${where}: editable but not in the schema`);
    if (f.bulkEditable && f.editable !== 'always') {
      p(`${where}: bulk-editable fields must be editable after create`);
    }
    if (f.importable && !f.editable) p(`${where}: importable fields must be editable`);
    if (f.searchable === 'text' && f.kind !== 'text') {
      p(`${where}: text search on a non-text field`);
    }
    if (cls.freeText && !f.detailOnly) p(`${where}: free text must be detail-only`);
    if (f.detailOnly) {
      const why = `${where} is detail-only`;
      if (f.searchable) p(`${why} and cannot be searchable`);
      if (f.filterable) p(`${why} and cannot be filterable`);
      if (f.sortable) p(`${why} and cannot be sortable`);
      if (f.bulkEditable) p(`${why} and cannot be bulk-editable`);
      if (f.importable) p(`${why} and cannot be importable`);
      if ((def.list.defaultColumns as readonly string[]).includes(name)) {
        p(`${why} and cannot be a default list column`);
      }
    }
  }
  if (has('reveal') && revealable === 0) p('declares reveal but no field can be revealed');
  if (!has('reveal') && revealable > 0) p('has revealable fields but no reveal action');

  const known = (name: string) => Object.prototype.hasOwnProperty.call(fields, name);

  // Rules
  for (const r of def.rules?.required ?? []) {
    if (!known(r)) p(`required field ${r} is not declared`);
    else if (!fields[r]?.editable) p(`required field ${r} is not editable`);
  }

  // List and detail
  if (def.list.defaultColumns.length === 0) p('list needs default columns');
  for (const c of def.list.defaultColumns) if (!known(c)) p(`default column ${c} is not declared`);
  for (const s of def.list.defaultSort) {
    if (!known(s.field)) p(`default sort ${s.field} is not declared`);
    else if (!fields[s.field]?.sortable) p(`default sort ${s.field} is not sortable`);
  }
  for (const section of def.detail.sections) {
    if (!section.fields && !section.custom) p(`detail section ${section.id} is empty`);
    for (const f of section.fields ?? []) {
      if (!known(f)) p(`detail section ${section.id} names unknown field ${f}`);
    }
  }
  for (const tab of def.detail.tabs) {
    if (!(DETAIL_TABS as readonly string[]).includes(tab)) p(`unknown detail tab ${tab}`);
  }
  if (def.detail.tabs.includes('comments') !== def.comments) {
    p('the comments tab and the comments opt-in disagree');
  }

  // History: an allowlist of categories, never auth, integration, or system events.
  const categories = def.history?.categories ?? [];
  if (categories.length === 0) p('history needs at least one audit category');
  for (const c of categories) {
    if (!(HISTORY_CATEGORIES as readonly string[]).includes(c)) {
      p(`history category ${c} is not allowed`);
    }
  }
  if (new Set(categories).size !== categories.length) p('history categories repeat');

  // Access
  for (const [action, verbs] of Object.entries(ACCESS_VERBS)) {
    const perm = def.access[action as keyof typeof ACCESS_VERBS] as Permission | undefined;
    if (perm === undefined) {
      if (action !== 'approve') p(`access.${action} is missing`);
      continue;
    }
    const i = perm.indexOf(':');
    const module = perm.slice(0, i);
    const verb = perm.slice(i + 1) as PermissionVerb;
    if (module !== def.module) p(`access.${action} ${perm} is not a ${def.module} permission`);
    if (!verbs.includes(verb)) p(`access.${action} ${perm} must use ${verbs.join(' or ')}`);
  }
  for (const r of def.access.recordRules) {
    if (!(RECORD_RULES as readonly string[]).includes(r)) p(`unknown record rule ${r}`);
  }
  if (!def.access.recordRules.includes('site_scope')) p('every type applies the site_scope rule');
  if (def.access.recordRules.includes('own') && !def.owner) {
    p('the own rule needs an owner field');
  }

  // Actions
  for (const a of def.actions) {
    if (!(RECORD_ACTIONS as readonly string[]).includes(a)) p(`unknown action ${a}`);
  }
  for (const a of ['list', 'get', 'history'] as const) {
    if (!has(a)) p(`every type serves ${a}`);
  }
  if (def.readOnly) {
    for (const a of WRITE_ACTIONS) if (has(a)) p(`read-only type declares ${a}`);
  }
  if (!def.readOnly && !has('create') && !def.managedBy) {
    p('a writable type without generic create must say what manages it (managedBy)');
  }
  if ((has('archive') || has('restore')) && !def.archivable) {
    p('archive and restore need an archived_at column (archivable)');
  }
  if (has('archive') !== has('restore')) p('archive and restore come together');
  if ((has('update') || has('archive')) && !def.versioned) {
    p('changes need a row_version column (versioned)');
  }
  if (has('bulk')) {
    const bulkFields = Object.values(fields).some((f) => f.bulkEditable);
    if (!bulkFields && !has('archive')) p('bulk needs bulk-editable fields or archive');
  }
  if (
    !has('update') &&
    Object.values(fields).some((f) => f.editable === 'always' && !has('create'))
  ) {
    p('editable fields without create or update');
  }
  if (has('import') !== def.import.enabled) p('the import action and import.enabled disagree');
  if (def.import.enabled) {
    if (!has('create')) p('import needs create');
    for (const k of def.import.naturalKey) {
      if (!known(k)) p(`import natural key ${k} is not declared`);
      else if (!fields[k]?.importable) p(`import natural key ${k} is not importable`);
    }
  }
  for (const [field, aliases] of Object.entries(def.import.headers)) {
    if (!known(field)) p(`import header aliases for unknown field ${field}`);
    else if (!fields[field]?.importable) p(`import header aliases for non-importable ${field}`);
    for (const alias of aliases) {
      if (classifySsnColumnName(alias)) p(`import header "${alias}" looks like an SSN (D1)`);
    }
  }
  for (const b of def.archiveBlockedBy ?? []) {
    if (!(ARCHIVE_BLOCKERS as readonly string[]).includes(b)) p(`unknown archive blocker ${b}`);
    if (!def.archivable) p('archive blockers on a type that cannot be archived');
  }

  // Site scope (a type without one fails)
  const scope = def.siteScope as unknown;
  if (scope === undefined || scope === null) p('site scope is not declared');
  else if (scope === 'organization') {
    // Explicit and reviewed: organization-wide records.
  } else if (typeof scope === 'object' && 'column' in scope) {
    const c = (scope as { column: string }).column;
    if (!classOf(c)) p(`site scope column ${c} is not in ${def.table}`);
  } else if (typeof scope === 'object' && 'self' in scope) {
    if (def.table !== 'public.site') p('only the site table is scoped by its own id');
  } else if (typeof scope === 'object' && 'via' in scope) {
    const via = (scope as { via: string }).via;
    if (!(SITE_SCOPE_JOINS as readonly string[]).includes(via)) p(`unknown site scope join ${via}`);
  } else p('site scope is not valid');

  // Catalog
  for (const id of def.requirementIds) {
    if (!RequirementId.safeParse(id).success) p(`requirementId ${id} is not a catalog id`);
  }
  if (def.requirementIds.length === 0 && !def.nonRegulatory && !def.catalogPending) {
    p('declare requirementIds, nonRegulatory: true, or catalogPending');
  }
  if (def.nonRegulatory && def.requirementIds.length > 0) {
    p('a non-regulatory type lists no requirementIds');
  }
  if (def.rowRequirementIdField && !known(def.rowRequirementIdField)) {
    p(`rowRequirementIdField ${def.rowRequirementIdField} is not declared`);
  }
  for (const f of def.readinessFields) if (!known(f)) p(`readiness field ${f} is not declared`);

  // Lifecycle and owner
  const lc = def.lifecycle;
  if (lc) {
    const field = fields[lc.field];
    if (!field) p(`lifecycle field ${lc.field} is not declared`);
    else if (field.kind !== 'enum') p('lifecycle field must be an enum');
    else if ([...(field.values ?? [])].sort().join() !== [...lc.states].sort().join()) {
      p('lifecycle states must equal the lifecycle field values');
    }
    if (!lc.states.includes(lc.initial)) p('lifecycle initial state is not a state');
    for (const d of lc.derived) if (!lc.states.includes(d)) p(`derived state ${d} is not a state`);
    for (const t of lc.transitions) {
      if (!isSnakeKey(t.id)) p(`transition ${t.id} must be snake_case`);
      if (!lc.states.includes(t.to)) p(`transition ${t.id} goes to an unknown state`);
      if (lc.derived.includes(t.to)) p(`transition ${t.id} sets a derived state`);
      for (const f of t.from) if (!lc.states.includes(f)) p(`transition ${t.id} from ${f}`);
    }
    if (field?.editable) p('the lifecycle field changes only through transitions and jobs');
  }
  if (def.owner) {
    const f = fields[def.owner.field];
    if (!f) p(`owner field ${def.owner.field} is not declared`);
    else if (f.kind !== 'uuid') p('owner field must be a person id');
  }

  if (def.fixture.trim() === '') p('fixture factory key is required');
  return problems;
}

/** Every problem in a registry, including duplicate ids and routes. */
export function validateRegistry(types: readonly RecordTypeDef[]): string[] {
  const problems = types.flatMap(validateRecordType);
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const t of types) {
    if (ids.has(t.id)) problems.push(`${t.id}: duplicate record type id`);
    ids.add(t.id);
    const route = `${t.module}/${t.slug}`;
    if (routes.has(route)) problems.push(`${t.id}: duplicate list route ${route}`);
    routes.add(route);
  }
  return problems;
}

export { ARCHIVE_BLOCKERS };
