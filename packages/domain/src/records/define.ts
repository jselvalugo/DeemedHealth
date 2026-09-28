/**
 * The `RecordType` declaration (ADR-0014 section 1). A record type is declared once,
 * in TypeScript, and the platform serves its list, detail, API, export, import, saved
 * views, bulk actions, and history. Declarations are pure data: no database, React, or
 * I/O. The database binding (SQL for site scope, owner rules, archive blockers) lives
 * in `apps/api/src/records/bindings.ts`.
 *
 * Sensitivity class, encryption, FIPA tag, and display default are NOT declared here:
 * they come from the generated column classes (`../generated/column-classes.ts`,
 * produced from the data dictionary), so the data dictionary stays the single source.
 */
import type { ZodObject, ZodRawShape } from 'zod';
import type { ModuleId } from '../modules.js';
import type { Permission, RoleId } from '../permissions.js';

/** How the API parses, filters, and serializes a field. */
export const FIELD_KINDS = [
  'text',
  'uuid',
  'date',
  'timestamp',
  'enum',
  'boolean',
  'integer',
  'text_array',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Generic actions the framework serves. Each maps to one `access` permission. */
export const RECORD_ACTIONS = [
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
  'views',
] as const;
export type RecordAction = (typeof RECORD_ACTIONS)[number];

/** Actions a read-only record type (audit log, catalog) may never declare (ADR-0014 section 4.1). */
export const WRITE_ACTIONS: readonly RecordAction[] = [
  'create',
  'update',
  'archive',
  'restore',
  'bulk',
  'import',
];

/**
 * Record rules: a closed list (ADR-0014 section 5). Adding one needs `suite-architect`
 * review. `executive_area` and `not_self` apply to approvals (S5), `assigned` and
 * `board_packet_member` to tasks and governance; they are listed so a type can name
 * them, and the registry test refuses any other string.
 */
export const RECORD_RULES = [
  'site_scope',
  'own',
  'assigned',
  'board_packet_member',
  'not_self',
  'executive_area',
  'auditor_scope',
  'state_lock',
] as const;
export type RecordRule = (typeof RECORD_RULES)[number];

/** Named joins that give the sites of a record linked to several sites. */
export const SITE_SCOPE_JOINS = ['person_sites', 'user_account_sites'] as const;
export type SiteScopeJoin = (typeof SITE_SCOPE_JOINS)[number];

/**
 * How a record's sites are found (ADR-0014 section 5, layer 4).
 *  - `{ column }`: one nullable site column; NULL means organization-wide.
 *  - `{ self: true }`: the record IS a site (its own id is its scope).
 *  - `{ via }`: a named join; visible when any linked site is in scope.
 *  - `'organization'`: organization-wide records; writes need an organization-wide grant.
 */
export type SiteScopeDecl =
  { column: string } | { self: true } | { via: SiteScopeJoin } | 'organization';

/** Named archive blockers; the API binding supplies the SQL for each. */
export const ARCHIVE_BLOCKERS = [
  'active_user_account',
  'active_role_assignment',
  'active_requirement_instance',
] as const;
export type ArchiveBlocker = (typeof ARCHIVE_BLOCKERS)[number];

export interface RevealSpec {
  /** Roles that may reveal the field (still needs `read` on the record, step-up, and a reason). */
  roles: readonly RoleId[];
  stepUp: true;
}

export interface FieldDef {
  /** Database column in the bound table; must be classified in the data dictionary. */
  column: string;
  kind: FieldKind;
  /** Allowed values of an `enum` field. */
  values?: readonly string[];
  /** Column accepts NULL. */
  nullable?: boolean;
  /** `text`: substring search; `exact`: equality only. */
  searchable?: 'text' | 'exact';
  filterable?: boolean;
  sortable?: boolean;
  /**
   * Who sets the value: `create` (on create only), `always` (create and update).
   * Omitted: system-managed and read-only through the API.
   */
  editable?: 'create' | 'always';
  bulkEditable?: boolean;
  importable?: boolean;
  /** Masked fields only: revealed one at a time, audited (ADR-0007, ADR-0014 section 4.5). */
  reveal?: RevealSpec;
  /**
   * Shown on the record page only: never in lists, exports, filters, sorts, or search.
   * Required for free-text columns (reasons, comments), which may hold anything.
   */
  detailOnly?: boolean;
}

/**
 * Audit categories a record's history may show (ADR-0014 section 2.6). Never `auth`
 * (sessions, MFA, step-up, and denials belong to the audit log, not the record page),
 * `integration`, or `system`.
 */
export const HISTORY_CATEGORIES = [
  'mutation',
  'permission',
  'reveal',
  'export',
  'approval',
] as const;
export type HistoryCategory = (typeof HISTORY_CATEGORIES)[number];

export interface LifecycleTransition {
  id: string;
  from: readonly string[];
  to: string;
  permission: 'update' | 'approve';
  reasonRequired?: boolean;
  requiresApproval?: string;
}

export interface LifecycleDecl {
  /** Field that holds the lifecycle state. */
  field: string;
  initial: string;
  states: readonly string[];
  transitions: readonly LifecycleTransition[];
  /** States only jobs set (never users, never imports). */
  derived: readonly string[];
  /** States an import may create besides `initial`. */
  importable?: readonly string[];
}

export interface DetailSection {
  id: string;
  fields?: readonly string[];
  /** Key of a module-provided React section instead of a field group. */
  custom?: string;
}

export const DETAIL_TABS = ['evidence', 'tasks', 'comments', 'approvals', 'history'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export interface AccessDecl {
  read: Permission;
  create: Permission;
  update: Permission;
  archive: Permission;
  export: Permission;
  approve?: Permission;
  recordRules: readonly RecordRule[];
}

export interface ImportDecl {
  enabled: boolean;
  /** Fields that identify an existing record (create or update). */
  naturalKey: readonly string[];
  /** Header aliases per field, English and Spanish (the field name always matches too). */
  headers: Readonly<Record<string, readonly string[]>>;
}

export interface RecordTypeDef<
  Id extends string = string,
  F extends Record<string, FieldDef> = Record<string, FieldDef>,
> {
  /** Stable, snake_case, never reused (like a requirementId). */
  id: Id;
  module: ModuleId;
  /** Bound table, `schema.table`; must be in the data dictionary with scope `tenant`. */
  table: string;
  /** List route segment under the module (`''` = the module root). */
  slug: string;
  /** Noun used in generated audit action descriptions ("Site created"). */
  noun: string;
  /**
   * The module's Zod shape for the record's fields (camelCase keys = field names).
   * Create and update payloads are derived from it (`.pick` of editable fields); the
   * server re-parses every payload.
   */
  schema: ZodObject<ZodRawShape>;
  fields: F;
  rules?: {
    /** Always required on create. */
    required?: readonly (keyof F & string)[];
    /** Cross-field checks on the merged record; return the paths of invalid fields. */
    refine?: (record: Readonly<Record<string, unknown>>) => string[];
  };
  lifecycle?: LifecycleDecl;
  /** Owner column shown in the header (`owner_person_id`). */
  owner?: { field: keyof F & string };
  list: {
    defaultColumns: readonly (keyof F & string)[];
    defaultSort: readonly { field: keyof F & string; dir: 'asc' | 'desc' }[];
  };
  detail: { sections: readonly DetailSection[]; tabs: readonly DetailTab[] };
  /** Which audit categories the History tab shows (successful events only). */
  history: { categories: readonly HistoryCategory[] };
  access: AccessDecl;
  /** Generic actions this type serves. Read-only types declare no write action. */
  actions: readonly RecordAction[];
  readOnly?: boolean;
  siteScope: SiteScopeDecl;
  /** Catalog requirementIds the record evidences or is the subject of. */
  requirementIds: readonly string[];
  /** Explicitly non-regulatory (with `requirementIds: []`). */
  nonRegulatory?: boolean;
  /**
   * Regulatory, but the catalog has no compiled ids for it yet (ADR-0003); the
   * `hrsa-regulatory-analyst` fills `requirementIds` when the entries are published.
   */
  catalogPending?: string;
  /** A field whose value is the row's own requirementId (audit `requirement_ids`). */
  rowRequirementIdField?: keyof F & string;
  /** A change to any of these enqueues the readiness recompute (S5 jobs). */
  readinessFields: readonly (keyof F & string)[];
  import: ImportDecl;
  /** Archive is refused while any of these exist (ADR-0014 section 2.4). */
  archiveBlockedBy?: readonly ArchiveBlocker[];
  /** Table has `archived_at` (soft delete). */
  archivable: boolean;
  /** Table has `row_version` (optimistic concurrency). */
  versioned: boolean;
  /** Key of the fixture factory in `packages/test-fixtures/src/records.ts`. */
  fixture: string;
  supportReadable: boolean;
  publicRecord: 'likely' | 'no' | 'to_verify';
  comments: boolean;
  /** Why generic create/update/archive are off, when the type is managed elsewhere. */
  managedBy?: string;
}

/**
 * Declares a record type. `const` type parameters keep the literal id and field names,
 * so `RecordTypeId` and field references are checked at compile time.
 */
export function defineRecordType<const Id extends string, const F extends Record<string, FieldDef>>(
  def: RecordTypeDef<Id, F>,
): RecordTypeDef<Id, F> {
  return def;
}

/** `record.<type>.field.<field>`: the EN/ES label key of a field. */
export function fieldLabelKey(typeId: string, field: string): string {
  return `record.${typeId}.field.${field}`;
}

/** `record.<type>.name`: the EN/ES name key of a record type. */
export function recordNameKey(typeId: string): string {
  return `record.${typeId}.name`;
}

/** camelCase or snake_case to snake_case, with a loop (no regex on input). */
export function toSnake(name: string): string {
  let out = '';
  for (const ch of name) {
    const lower = ch.toLowerCase();
    if (ch !== lower) out += `_${lower}`;
    else out += ch;
  }
  return out;
}

/** `schema.table` → `table` (the audit log's `target_table`). */
export function bareTable(table: string): string {
  const dot = table.indexOf('.');
  return dot < 0 ? table : table.slice(dot + 1);
}
