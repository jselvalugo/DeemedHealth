# ADR-0014: Record management pattern

- Status: **Proposed**
- Date: 2026-09-27
- Owner: `suite-architect`
- Reviewers required: `security-privacy-officer` (per-record access, masking, reveal,
  export, import), `data-architect` (row version, archive columns, shared record tables,
  indexes), `backend-engineer` (generic API, policy compilation), `design-system-engineer`
  (`RecordTable`, `RecordPage`, `RecordForm`), `hrsa-regulatory-analyst` (lifecycles that
  carry approvals, archive of regulatory records, Sunshine rules), `qa-test-engineer`
  (generated route tests), product owner (@jselvalugo, roadmap decision D14)
- Builds on: ADR-0001 (layout and dependency rules), ADR-0002 (RLS, site scoping in the
  API), ADR-0003 (catalog is Git data), ADR-0007 (field encryption, reveal), ADR-0008
  (audit log, redaction, export), ADR-0011 (names), ADR-0012 (support grants scope by
  record type), ADR-0013 (feature flags)
- Related decisions: D1 (no SSN), D4 (Florida only), D9 (synthetic data only), D13
  (executives approve only within their own area, accepted; research in
  `docs/compliance/approval-authority.md`)
- Amends, on acceptance: `docs/product/module-map.md` (new "Record types" section and
  record routes), `docs/brand/design-system.md` §5 (DataTable, Drawer, Timeline become
  `RecordTable`, `RecordPage`, `RecordForm`), `docs/data/erd.md` (row version, archive
  columns, `saved_view`, `record_comment`, `record_evidence_link`, task subject),
  `CLAUDE.md` definition of done (item 7, see Consequences)

## Context

The product owner asked: "I would love for each table independently to be able to be
managed by records." Read with the module map, this means every list or table in the
suite (providers, credentials, payers, enrollments, screening results, board members,
meetings, policies, contracts, requirements, evidence, tasks, users, sites, and so on) is
a first-class **record type**. Each row opens its own **record page** and can be managed
on its own: create, edit, archive, restore, status, owner, evidence, tasks, comments,
approvals, and full history from the audit log. Access is controlled per record by role,
site scope, and record rules.

The module map has 16 modules and about 70 pages, and most pages are lists of one kind of
record. Built by hand, each list would repeat the same work (filters, sort, pagination,
export, bulk actions, the four page states, EN/ES labels, masking, history) and the same
controls (tenant context, policy checks, audit, redaction, the four route tests) about 40
times. Each copy is a place where a control can be missed: a filter on an encrypted
field, an export that forgets masking, a list that pages before it applies site scope, a
bulk update that skips the audit event. The architectural rules (everything is a
requirement instance, tasks are the only action surface, approvals are explicit, the
audit log is append-only, RLS in the database) are easier to keep if one code path
serves every table.

What already exists on `main`:

- `packages/domain`: Zod entities (`Approval`, `Task`, `Evidence`, `Person`, ...),
  `Permission` = `<moduleId>:<verb>` with verbs `read`, `read_own`, `write`, `approve`,
  `export`, and the default roles (`permissions.ts`). The executive role has `read` and
  `approve` on every module; "approvals in their area" is left to a record rule.
- `packages/db`: `withTenant(db, organizationId, actor, fn, { siteIds, roles })`, which
  sets `app.organization_id`, `app.actor_id`, `app.request_id`, `app.site_ids`,
  `app.roles`; `appendAuditEvent`; the data dictionary (`DATA_DICTIONARY`) with a
  sensitivity class, encryption, FIPA tag, and display default (`shown`, `masked`,
  `hidden`) for every column; `rowMeta()` and `archived_at` on business tables.
- `packages/ui`: shell, launcher, module registry, basic components. `DataTable`,
  `Drawer`, `Timeline`, and form controls are still to build (design system §5).
- No row version column exists, tasks have no subject link, and evidence links only to
  requirement instances.

## Decision

Adopt a **typed record-type registry**. A record type is declared once, in TypeScript,
and the platform provides the list, detail, form, API, import/export, filters, saved
views, bulk actions, and history for it. Module code keeps the business rules; the
framework keeps the controls.

### 1. The `RecordType` registry

**Location.** Pure declarations live in `packages/domain/src/records/` (no database or
React dependency, per ADR-0001). One file per record type under
`packages/domain/src/records/types/<module>/`, collected in `registry.ts`. The database
binding (Drizzle table and module hooks) lives in `apps/api/src/records/bindings.ts`;
React components for custom sections live in the module's web code and are referenced
by key. CODEOWNERS: `suite-architect` on `registry.ts` and the framework; the domain
specialist on its module's definitions; `security-privacy-officer` on any field whose
class is PII or PHI.

**Shape** (illustrative; the S4b PR fixes the exact types):

```ts
export const credential = defineRecordType({
  id: 'credential',                         // stable, snake_case, never reused
  module: 'providers',                      // ModuleId from the module map
  table: 'public.credential',               // must exist in DATA_DICTIONARY
  slug: 'credentials',                      // list /providers/credentials
  nameKey: 'record.credential.name',        // EN/ES keys; plural and article forms too
  schema: CredentialSchema,                 // Zod entity from packages/domain/entities
  fields: {
    kind:          { column: 'kind', filterable: true, sortable: true },
    licenseNumber: { column: 'license_number', searchable: 'exact' },
    issuingState:  { column: 'issuing_state', filterable: true },
    validTo:       { column: 'valid_to', filterable: true, sortable: true },
    deaNumber:     { column: 'dea_number', reveal: { roles: ['compliance_officer',
                     'credentialing_coordinator'], stepUp: true } },
  },
  rules: {
    required: ['personId', 'kind'],                          // always
    requiredIn: { verified: ['verifiedOn', 'verificationSource'] },
    refine: 'providers.credential.validate',                 // module hook, same transaction
  },
  lifecycle: {
    initial: 'pending_verification',
    states: ['pending_verification', 'verified', 'expired', 'revoked'],
    transitions: [
      { id: 'verify', from: ['pending_verification'], to: 'verified', permission: 'write' },
      { id: 'revoke', from: ['verified'], to: 'revoked', permission: 'write',
        reasonRequired: true },
    ],
    derived: ['expired'],                   // set by a job from catalog parameters, not by users
  },
  owner: true,                              // owner_person_id; shown in the header
  list: { defaultColumns: ['person', 'kind', 'issuingState', 'status', 'validTo'],
          defaultSort: [{ field: 'validTo', dir: 'asc' }] },
  detail: { sections: [
      { id: 'summary', fields: ['person', 'kind', 'licenseNumber', 'issuingState', 'validTo'] },
      { id: 'verification', fields: ['verificationSource', 'verifiedOn', 'deaNumber'] },
      { id: 'psv', custom: 'providers.PsvPanel' },
    ],
    tabs: ['evidence', 'tasks', 'comments', 'approvals', 'history'] },
  access: {
    read: 'providers:read', create: 'providers:write', update: 'providers:write',
    archive: 'providers:write', approve: 'providers:approve', export: 'providers:export',
    recordRules: ['site_scope'],
  },
  siteScope: { via: 'person_sites' },       // or { column: 'site_id' } or 'organization'
  requirementIds: ['<draft ids from the catalog>'],
  readinessFields: ['status', 'validTo'],   // a change enqueues a recompute (transactional)
  import: { enabled: true, naturalKey: ['personNpi', 'kind', 'licenseNumber'],
            headers: { licenseNumber: ['License number', 'Número de licencia'] } },
  bulkEditable: ['owner', 'issuingState'],
  supportReadable: true,                    // may be named in an ADR-0012 support grant scope
});
```

**What each type declares, and the rules on it:**

| Declaration | Rule |
| --- | --- |
| `id`, `module`, `table`, `slug` | `module` is a `ModuleId`; `table` is in the data dictionary with `scope: 'tenant'` (or is one of the read-only types in §4). `id` is stable, like a `requirementId`. |
| `schema` | The module's Zod entity. Create and update payloads are derived from it (`.pick`/`.partial` of the editable fields); the server re-parses every payload. |
| Field metadata | Label key (`record.<type>.field.<field>`, EN and ES), `searchable` (`text` or `exact`), `filterable`, `sortable`, `bulkEditable`, `importable`, `reveal`. **Sensitivity class, encryption, FIPA tag, and display default are not typed by hand**: a generated file (`packages/domain/src/generated/column-classes.ts`, produced from `DATA_DICTIONARY`, CI fails when stale) supplies them, so the data dictionary stays the single source. |
| Field constraints enforced by the registry test | A field whose class is PHI, or whose display is `masked` or `hidden`, cannot be `searchable` (except `exact` against a blind index, and only with a `security-privacy-officer` approval), `filterable`, `sortable`, `bulkEditable`, or a default list column; it is never in exports or imports unless §2.8 says so. Every `sortable` or `filterable` column leads an index after `organization_id` (checked against `pg_indexes` in the migration test). No field name or header alias matches the SSN detector (D1). |
| `rules` | `required` and `requiredIn` per lifecycle state; cross-field checks as a named module hook that runs inside the same transaction. Rule parameters (lead days, intervals, thresholds) come from the catalog, never from the definition. |
| `lifecycle` | States, the initial state, transitions (`from`, `to`, permission, `reasonRequired`, `requiresApproval: <approvalTypeId>`), and `derived` states that only jobs set. A transition with `requiresApproval` creates an approval request through the Tasks service; the state changes only when a human `Approval` for that row version is recorded. Lifecycle status is separate from archive. |
| `list`, `detail` | Default columns and sort; detail sections (field groups, or a `custom` component key) and which standard tabs apply. |
| `access` | One `Permission` per action (read, create, update, archive, approve, export), plus named record rules (§5). `restore`, `bulk_update`, and `import` use `update`/`create`; `history` uses `read`. No new permission verbs. |
| `siteScope` | `{ column }`, `{ via: <named join> }`, or `'organization'` (explicit and reviewed: organization-wide records such as policies). A type with no declaration fails the registry test. |
| `requirementIds` | Catalog `requirementId`s the record can evidence or is the subject of; checked against the compiled catalog (draft or verified). A non-regulatory type declares `requirementIds: []` and `nonRegulatory: true`. |
| `readinessFields` | A change to any of these enqueues the readiness recompute in the same transaction (ADR-0001 pg-boss rule). |
| `import` | Enabled flag, natural key for de-duplication, EN/ES header aliases. |
| `owner`, `comments`, `supportReadable`, `publicRecord` | Opt-ins for the shared tabs, ADR-0012 grant scope, and the ch. 119 hint (§4.5). |

**Module hooks.** Business rules stay in the module's domain service. The binding may
name hooks from a closed list: `validate`, `beforeCreate`, `beforeUpdate`,
`beforeArchive`, `afterCommit` (enqueue only), and custom `actions` (named server
operations with their own permission and audit action). Hooks run inside the
framework's transaction; they cannot open another transaction, skip the audit
middleware, or call `withPlatform`.

### 2. Generic API

Mounted in `apps/api` under `/api/records/:recordType`. Every handler runs in
`withTenant` with the session's `siteIds` and `roles`, goes through the policy engine
(S3) before and inside the query, and writes through the audit middleware. No handler
reads or writes a table that is not the bound table, its registered child tables, or
the shared record tables in §3.

| Method and path | Action | Notes |
| --- | --- | --- |
| `GET /api/records/:type` | list | Filters, sort, search, cursor pagination, saved view |
| `GET /api/records/:type/:id` | get | Returns `rowVersion`, masked fields as masked, allowed actions for this viewer |
| `POST /api/records/:type` | create | Zod parse, rules, initial state, audit `<type>.create` |
| `PATCH /api/records/:type/:id` | update | `If-Match: "<rowVersion>"` required |
| `POST /api/records/:type/:id/transitions/:transition` | status | Lifecycle transition; reason when required |
| `POST /api/records/:type/:id/archive` and `/restore` | archive, restore | Soft delete only; reason required on archive |
| `POST /api/records/:type/bulk` | bulk update | Listed fields or archive; per-row checks |
| `GET /api/records/:type/:id/history` | history | From `audit.audit_event` |
| `POST /api/records/:type/:id/reveal/:field` | reveal | Step-up, reason, audited (ADR-0007) |
| `POST /api/records/:type/exports` | export | CSV or XLSX; job; re-auth |
| `POST /api/records/:type/imports` and `/imports/:importId/commit` | import | Dry run first, then commit |
| `GET/POST/PATCH /api/saved-views?recordType=` | saved views | Private or shared |

There is **no `DELETE` route** for any record type.

1. **List.** Filters as `filter[<field>][<op>]=<value>` with operators by field type
   (`eq`, `in`, `lt`, `lte`, `gt`, `gte`, `between`, `is_null`, `contains` for `text`
   search fields), only on `filterable` fields; `sort` only on `sortable` fields, with
   `id` appended as the tiebreaker; `q` searches `searchable` fields. **Keyset
   pagination**: the cursor is an opaque, HMAC-signed encoding of the last row's sort
   values and id, bound to the record type, filters, and viewer; limit 50 by default, 200
   maximum. Totals are counted under the same filters and scope. Archived rows are
   excluded unless `archived=only|include` and the viewer has `update`.
2. **Scope before paging.** Site scope and record rules compile to SQL predicates added
   to the query, so a page never contains rows the viewer cannot see and counts never
   reveal them. The same rules are evaluated in memory on `get` and on every mutation.
   A record outside the viewer's scope returns `404`, not `403`, so its existence does
   not leak; a visible record with a forbidden action returns `403`.
3. **Optimistic version.** Business tables gain `row_version integer NOT NULL DEFAULT 1`,
   incremented by the existing `set_row_meta()` trigger. `PATCH`, transitions, archive,
   and restore require `If-Match`; a mismatch returns `409 version_conflict` with the
   current version and the changed fields the viewer may see. `Approval.subjectVersion`
   pins `row_version` (or `evidence_version.version_no` for evidence). Temporal tables
   (`valid_from`/`valid_to`, ERD conventions) are updated by closing the current row and
   opening a new one; the framework does this when the type declares `temporal: true`.
4. **Archive and restore.** Soft delete only: `archived_at`, `archived_by`, and
   `archive_reason` (new columns). Archive is refused when the record is under legal
   hold, has an open approval request, or is referenced by an active record the type
   lists in `archiveBlockedBy`. Archiving a record that evidences a requirement
   enqueues a recompute; archived evidence stops counting from the archive date and past
   snapshots are unchanged (ADR-0003 rule 4). Hard deletion is never an API action; only
   retention jobs delete, with a reason (ADR-0008).
5. **Bulk update.** At most 500 ids; only `bulkEditable` fields, owner, or archive; never
   approve, reveal, or a transition that requires approval. Each row is checked on its
   own (policy, version, rules) and written with its own audit event carrying
   `metadata.bulk_id`; the response lists per-row results.
6. **History.** Events for `(target_table, target_id)` from `audit.audit_event`, read
   under RLS, shown with the stored redacted diff (ADR-0008 §5), plus the record's
   approvals and comments on one timeline. It needs the type's `read` permission and
   passes the same site scope. The auditor role sees history only under the
   `audit_log_read` expansion (approval-authority §5.3), when that research is accepted. Needs an index on
   `(organization_id, target_table, target_id, occurred_at)`.
7. **Export.** CSV or XLSX of the current filters and the viewer's visible columns.
   Requires re-authentication (5 minutes, ADR-0006), runs as a job above 1,000 rows, and
   stores the file in the evidence store with a short-lived presigned link. Masked,
   hidden, and PHI fields are exported masked or not at all; there is no "export with
   reveal" in this ADR. Cells starting with `=`, `+`, `-`, `@`, tab, or carriage return
   are prefixed to prevent formula injection. The file header names the organization,
   the viewer, the time, the filters, and in non-production the PREVIEW label. One
   `export` audit event records the type, filters, columns, row count, and SHA-256.
8. **Import with dry run.** Upload CSV or XLSX; the dry run maps headers by the EN/ES
   aliases, runs the SSN column guard and SSN-shaped value rejection (D1, S2 guard
   library), parses each row with the Zod schema and the rules, resolves natural keys to
   create or update, and returns a row-level report. Nothing is written. Commit requires
   the dry-run id and the same file SHA-256, re-validates, and writes in one transaction
   (5,000 rows maximum in this ADR). Imports create records only in the initial state or
   states marked `importable`, never create approvals, never set derived states, and never
   import PHI or `hidden` fields. Each row gets its own `<type>.create` or `<type>.update`
   event with `metadata.import_id`, plus one `<type>.import` event. **Import is behind a
   feature flag that is off in every deployed environment until G4** (ADR-0013 §4); CI
   runs it against synthetic fixtures only (D9; the Phase 1 risk "no importer").
9. **Tenant, policy, audit, tests.** All of the above runs through `withTenant`, the
   policy engine, and the audit middleware. Audit actions `<type>.create`, `.update`,
   `.transition`, `.archive`, `.restore`, `.import`, plus `reveal` and `export` events, are
   generated into `audit-actions.ts` from the registry (and seeded into
   `audit.action_registry`). The **route manifest** gets one entry per record type and
   action, and a generated test suite runs the **four required tests** for each entry:
   allowed role, denied role, other site, other tenant. Each record type supplies a
   fixture factory in `packages/test-fixtures`; a type without one fails CI. Roles that
   audit every view (`auditsEveryView`) get a read event for list and get calls, with
   the returned ids.

### 3. Generic UI in `packages/ui`, and routes

Components in `packages/ui/src/records/`, driven by the registry and the API's
"allowed actions" response (the UI never decides access by itself):

- **`RecordTable`**: a native `<table>` with caption, `scope` headers, and `aria-sort`;
  sticky header; column chooser (dialog); filter bar built from `filterable` fields with
  typed inputs (date inputs use `packages/dates`, displayed in the health center's time
  zone); saved views menu (private, or shared to roles); row selection with keyboard and
  a bulk action bar (only the actions allowed); cursor pager; export and import buttons
  when allowed; results announced in a polite live region. Empty, loading, error, and
  no-permission states from design system §4.5. No virtualization until measured need
  (screen readers). Headless table logic may use TanStack Table (MIT, npm).
- **`RecordPage`**: header with title, lifecycle status badge, owner, site, requirement
  chips (`CitationChip`), and allowed actions (edit, transition, archive or restore,
  request approval); detail sections from the definition; tabs for Evidence (attach,
  versions, links to requirement instances), Tasks (created through the Tasks service),
  Comments, Approvals (read-only list, plus "request approval"), and History (timeline).
  Masked fields show a reveal button that asks for a reason and step-up. Archived
  records show a banner and are read-only apart from restore.
- **`RecordForm`**: generated from the Zod schema and field metadata (labels, hints,
  required-in-state markers, inline errors in EN and ES); custom field widgets by key;
  sends `If-Match`; on `409` shows what changed and lets the user re-apply. Used in a
  drawer from the list (create) and inline on the record page (edit).
- **Routes.** List `/<module>/<slug>` and record `/<module>/<slug>/<id>` (`id` is a
  UUID; the route matcher accepts only UUIDs, so record ids never collide with page
  routes). Where a module-map page is already the list of a record type, the page names
  the type (`recordType` on `PageEntry`) and its route is the list route: for example
  Payers `/enrollment/payers`, and the module's primary type may use the module root
  (Providers `/providers`, records at `/providers/<id>`). Create opens the form drawer on
  the list route; there is no separate `/new` page.
- **Module map and launcher.** The module map gains a **"Record types"** table (record
  type, module, list route, record route, permission, status) and
  `packages/ui/module-registry.ts` gains `RECORD_TYPES` navigation entries generated
  from the domain registry, in one PR, with the existing registry test extended. The
  launcher shows record lists under their module; the command palette offers "Go to
  <records>", "New <record>" when create is allowed, and record search by `searchable`
  non-masked fields through the API.

### 4. Where the pattern does not apply, or applies with care

1. **`audit_event` is never editable.** It is a read-only record type (`list`, `get`,
   `export` only) that backs Administration › Audit log. The registry test fails if a
   read-only type declares create, update, archive, bulk, or import, and the database
   still grants no `UPDATE` or `DELETE` (ADR-0008 §1). It has no History tab (it is the
   history) and no comments.
2. **Catalog entries** (`requirement`, `requirement_version`, `catalog_release`) are
   global, read-only record types. They are changed only through Git and the catalog
   workflow (ADR-0003: PR with `hrsa-regulatory-analyst` review, compile, publish job).
   Tenant choices on them (a policy parameter within bounds, "Not applicable" with
   reason) are separate tenant record types (`requirement_instance`, parameter
   overrides) with their own audit actions.
3. **Approvals are immutable once recorded.** `approval` is an insert-only record type:
   no generic create, update, archive, or bulk. Approvals are made only through the
   Approval service (step-up, human actor, pinned version, the `app.actor_id` trigger in
   the ERD), from a record page's approval request. A changed decision is a new record.
   Self-approval is refused (not only hidden): nobody approves a record they submitted or
   one about themselves. Board and committee capacities follow the approval-authority
   model once accepted (liaison drafts, board officer confirms).
4. **Other immutable rows.** `evidence_version` (a new version is a new upload), readiness
   snapshots, notifications, support grants after approval, and temporal rows (close and
   open, never overwrite).
5. **PHI and restricted fields stay masked.** Display follows the data dictionary.
   Reveal is one field at a time, with reason and step-up, writes a `reveal` event, and
   is never cached in the list. PHI record types (FTCA incidents, grievances) keep the
   ADR-0002 rule 5 RLS predicate on `app.site_ids` and `app.roles` in addition to the API
   checks. Restricted documents (NPDB responses) are excluded from search, export, bulk,
   import, AI, and support grants. Comments on PHI record types are classed PHI and
   field-encrypted. No PII or PHI in URLs, cursors, saved-view names, or notification
   text.
6. **Sunshine and public records (Florida public-agency tenants, FL-D3).** For
   organizations with `is_public_agency` on: governance record types that carry
   `sunshine: true` require a board-capacity approval to link to a meeting record with a
   public notice date and location; comments between board members on those records are
   turned off (questions go to the board liaison); written consent and packet-comment
   approvals are off. Record types carry a `publicRecord` hint (`likely`, `no`,
   `to_verify`) for a future ch. 119 records-request export with exempt fields redacted;
   that export and any retention change wait for counsel (approval-authority
   §7, items C7 and C8) and are **not** in this
   ADR. Soft delete already keeps records for public-records retention.
7. **Operator and support access** does not use the generic API. ADR-0012 support grants
   name record types with `supportReadable: true` in their scope, and read through the
   `support_reader` functions; reveal, export, and import stay impossible under a grant.
8. **Not every screen is a record type.** Dashboards, the readiness overview, calendars,
   briefs, and the launcher are views over records and stay hand-built.

### 5. Per-record permissions

A request is allowed only if every layer allows it, evaluated in this order, deny by
default:

| Layer | Where | What it decides |
| --- | --- | --- |
| 1. Tenant | PostgreSQL RLS (ADR-0002, ADR-0011) | Only `app.organization_id` rows exist for the transaction. Hard boundary; the framework cannot change it. |
| 2. PHI defense in depth | RLS predicate on `app.site_ids`, `app.roles` | PHI tables only (ADR-0002 rule 5). |
| 3. Role permission | Policy engine | The type's `access` entry for the action (for example `providers:write` for update). |
| 4. Site scope | Policy engine, compiled to SQL | Declared `siteScope`; a record linked to several sites (a person at two sites) is visible when any of its sites is in the viewer's scope; `'organization'` types need a role with organization-wide scope for writes. |
| 5. Record rules | Policy engine, compiled to SQL and evaluated in memory | Named rules from a closed list: `own` (`read_own`: the record is about or assigned to the viewer), `assigned`, `board_packet_member`, `not_self` (no self-approval), `executive_area` (D13), `auditor_scope` (default auditor scope and per-engagement expansions, for example `cp_file_sample` limited to the listed record ids), `state_lock` (approved or archived rows are read-only). |
| 6. Field | Serializer | Masked and hidden fields per the data dictionary; reveal needs the field's `reveal.roles`, step-up, and a reason. |

**D13 executive area.** The executive role keeps `read` on every module, but
`approve` is allowed only when the approval type's `area` (catalog data, per the
approval-authority research) is in the executive's area mapping for that organization
and site. The mapping is a versioned tenant record type
(`executive_area_assignment`), edited by the compliance officer with a second approval
from the CEO, and linked to the board resolution or bylaws section that delegates the
authority. Until D13 and that research are accepted on `main`, `executive_area` denies
staff approvals by executives for any approval type without an `area` (fail closed).
Board-required approval types can never be recorded in staff capacity, whatever the
role.

Every denial writes an audit event with `outcome = denied` for the deniable categories
(ADR-0008 §4). Policy changes (role grants, area mapping, saved views shared to a role)
are `permission` events.

### 6. Shared record tables (hand-off to `data-architect`)

All tenant tables with forced RLS, `organization_id`, composite foreign keys, and data
dictionary entries:

- On every business table: `row_version`, `archived_by`, `archive_reason`, and
  `owner_person_id` where the type declares `owner`.
- `saved_view` (record type, owner account, name, visibility `private` or `roles`,
  filters, sort, columns). A saved view never widens access; it is evaluated with the
  viewer's permissions, and it cannot filter on masked fields.
- `record_comment` (record type, record id, author, body, `supersedes_id`); append-only,
  edits are new rows, removal is archive. Mentions create notifications that carry no
  comment text.
- `record_evidence_link` (record type, record id, evidence id, from, to), temporal, next
  to the existing `evidence_requirement_link`.
- `task.subject_record_type` and `task.subject_id`, so the Tasks service can list a
  record's tasks.
- `record_import` (dry-run report, file hash, status) and `record_export` (job, file key,
  hash, expiry).

## Alternatives considered

- **Hand-built pages and endpoints per module.** Full freedom per screen, no framework
  to learn. But the same controls are rebuilt about 40 times, each copy can miss one
  (masking in an export, scope before paging, a bulk path without audit), the four route
  tests are written by hand for every endpoint, and the product owner's ask (every table
  managed the same way) would depend on discipline. Rejected as the default; still used
  for dashboards and views (§4.8) and through `custom` sections and actions.
- **A low-code metadata engine.** Record types defined at runtime in database rows
  (entity-attribute-value or JSONB), with customer-configurable fields and forms, like a
  generic admin builder. Fast to add types, and customers could add their own. But it
  breaks the controls this suite depends on: RLS and indexes per real table, Zod types
  shared by API and UI, a sensitivity class for every column before it exists, reviewed
  migrations, catalog-driven rules, and CODEOWNERS review of PII and PHI fields. A
  customer could create an unclassified PHI field with no encryption. It also makes the
  regulatory review of a feature a review of data, not code. Rejected. Off-the-shelf
  admin frameworks with direct database access (AdminJS, Retool) are rejected for the
  same reasons as in ADR-0012.
- **A single generic `record` table with JSONB payloads.** One table for everything.
  Loses typed columns, foreign keys, per-table RLS predicates, and field encryption per
  column. Rejected.
- **Chosen: a typed registry (middle ground).** Record types are code, reviewed in PRs,
  compiled by TypeScript, bound to real tables that `data-architect` designs, and
  classified by the data dictionary. The platform supplies the repeated parts and the
  controls; modules supply the rules and any custom section. Adding a type is a small
  PR, not a new page stack, and it cannot be added without classification, a site scope,
  a fixture factory, and the four tests.

## Consequences

- One code path for list, detail, form, import, export, bulk, and history, so controls
  are proven once and inherited. The generated route tests make the four-test rule
  mechanical for every record type.
- Modules must fit the pattern or explicitly opt out with a `custom` section, a custom
  action, or a hand-built view. Unusual screens (the enrollment board, the committee
  review queue) are views over record types, not new record machinery.
- New columns on every business table (`row_version`, archive fields, owner) and four
  shared tables; one extra index on `audit_event`. S2 tables get a follow-up migration.
- The registry becomes an architectural surface: changes to the framework and to
  PII/PHI fields need `suite-architect` and `security-privacy-officer` review.
- `CLAUDE.md` definition of done gains, on acceptance, item 7: "Every list or table is a
  registered record type (or an explicitly listed view), with a fixture factory and the
  generated four-case tests."
- The module map gains the "Record types" table, and the launcher and command palette
  list record types; `packages/ui/module-registry.ts` and the module map change in one
  PR.
- Import stays off in deployed environments until G4, so reviewers cannot load real
  data (D9).
- Design system §5 "still to build" items DataTable, Drawer, Timeline, and form controls
  are delivered as parts of `RecordTable`, `RecordPage`, and `RecordForm`.

### Plan

**Phase 1 slice S4b "Records framework"**, after S3 (policy engine, audit middleware,
route manifest) and S1 (components), before S7 (whose Administration pages become the
first adopters). Details and the task table are in `docs/product/phase-1-plan.md` §4.
Owners: `design-system-engineer`, `backend-engineer`, `data-architect`,
`frontend-engineer`, `qa-test-engineer`, `ux-content-writer`, with `suite-architect`
(registry, module map) and reviews by `security-privacy-officer` and
`hrsa-regulatory-analyst`. First record types: `site`, `user_account` with
`role_assignment`, `requirement` (read-only), `audit_event` (read-only), and `task`
(service from S5; its pages ship in Phase 2). Evidence, tasks, and approvals tabs light
up as S5 and S6 land.

**Phase 2 adoption.** Each MVP module starts with its record type list in the plan
(step 1 of the feature handoff order): the domain specialist writes the definitions,
rules, and lifecycles; `hrsa-regulatory-analyst` confirms `requirementIds` and which
transitions need approvals; `data-architect` builds the tables; `ux-content-writer`
supplies labels; `frontend-engineer` builds only custom sections and views. Expected
types by module, in roadmap order:

| Module | Record types (first pass) |
| --- | --- |
| Providers & Credentialing | `provider_profile`, `credential`, `license`, `privilege`, `committee_review` |
| Screening | `screening_run`, `screening_result`, `possible_match` (cleared only by a human, with reason) |
| Enrollment | `payer`, `enrollment`, `revalidation`, `enrollment_application` |
| Governance | `board_membership`, `meeting`, `board_action`, `policy`, `coi_disclosure` |
| Tasks & Workflows | `task`, `workflow_run`, `approval` (insert-only) |
| HRSA Readiness | `requirement_instance`, `evidence`, `finding` |
| FTCA & Risk (Phase 3) | `risk_assessment`, `incident` (PHI), `claim`, `tracking_item` |
| Administration | `site`, `user_account`, `role_assignment`, `executive_area_assignment`, `requirement` (read-only), `audit_event` (read-only) |

### Risks and open questions

- Risk: the framework grows into a low-code engine. Mitigation: closed lists of field
  options, hooks, and record rules; additions need `suite-architect` review.
- Risk: keyset pagination with SQL-compiled record rules is slow on large tenants.
  Mitigation: index check in CI, 200-row cap, `EXPLAIN` tests on the seed at 10x volume.
- Risk: a generic export leaks a field the module meant to hide. Mitigation: export
  columns come from the data dictionary display rule, not from the table's visible
  columns alone; log-hygiene canaries (S8) run through export and import.
- For `security-privacy-officer`: may exports include PII shown in the list (names,
  work email, NPI, license number) with re-authentication, or should PII columns need an
  extra `export` confirmation? Should site-scoped roles see history events written by
  users at other sites? Are comments on non-PHI records `confidential` or `PII` by
  default? Is the 5,000-row, single-transaction import limit right for G4?
- For `hrsa-regulatory-analyst`: which lifecycle transitions are approvals that need an
  `approvalType` in the catalog (credential verification, privilege grant, possible
  match clearing, policy adoption)? May board-approved records (minutes, adopted
  policies) be archived at all, or only superseded? Does archiving evidence need a
  reason list tied to the catalog?

## Status

Proposed by `suite-architect` on 2026-09-27. Needs review by `security-privacy-officer`,
`data-architect`, `backend-engineer`, `design-system-engineer`, `hrsa-regulatory-analyst`,
and `qa-test-engineer`, and acceptance by the product owner (@jselvalugo) as roadmap
decision D14. The module map, ERD, design system, and `CLAUDE.md` changes listed above
are made on acceptance, in the S4b PRs.
