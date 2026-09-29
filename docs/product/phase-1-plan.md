# Phase 1 Plan · Platform core

Owner: `suite-architect`. Status: plan, 2026-09-27.
Source of scope and gate: `docs/product/implementation-roadmap.md` §4 (Phase 1,
G1) and §13 (D1–D11). Runtime: ADR-0010 (Proposed) on top of ADR-0001 to ADR-0009.
Operator console: ADR-0012 (Proposed). Environments: ADR-0013 (Proposed).
Records framework: ADR-0014 (Proposed, roadmap D14).

## 1. What is being built and why

The product owner asked to begin building the platform "from the login page
through the entire platform; landing pages come later." That is roadmap Phase 1:
every control that modules depend on is built once in the platform and proven by
tests, so the Phase 2 modules inherit it and cannot bypass it.

Phase 1 is mostly **non-regulatory platform work**, with these links to the
requirement framework:

- **Catalog and readiness engine** serve every Compliance Manual chapter the MVP
  covers (Ch. 3–21) by turning catalog entries into `RequirementInstance`s
  (principles 1 and 4, ADR-0003). Only draft entries exist today, so Phase 1 runs
  on drafts in non-production and on the FX-CAT fixtures.
- **Tasks and approvals** carry the human-decision rule that later backs board
  approvals (Ch. 19), committee credentialing decisions (Ch. 5), and FTCA
  tracking (Ch. 21). Approvals record approver, role, time, reason, and the
  approved version; only humans approve (roadmap §2 rule 4).
- **Identity, audit, encryption, and logging** implement HIPAA Security Rule
  safeguards: unique user identification, authentication, automatic logoff
  (45 CFR 164.312(a), (d)), audit controls (164.312(b)), and encryption
  (164.312(a)(2)(iv), (e)(2)(ii)); ADR-0006, ADR-0007, ADR-0008. These citations
  are planning assumptions (roadmap preface).

Every feature in this phase is marked "explicitly non-regulatory" in its PR
except S4 and S5, which cite catalog `requirementId`s through their fixtures.

### Starting conditions (decision D9)

- G0 is **not** closed. Open: AWS BAA, workforce training record, catalog source
  verification. Phase 1 starts in parallel, on **synthetic data only**, on
  Netlify (ADR-0009, ADR-0010). **G0 must close before G1** is signed.
- No real person, organization, or credential enters any environment
  (roadmap §2 rule 1). Dev accounts are synthetic personas (ADR-0010 §2).
- Landing and marketing pages are out of scope. Unauthenticated visitors to any
  route are sent to `/sign-in`.

## 2. Affected modules, entities, and pages

**Modules (module map):** Administration (16) ships its Phase 1 pages. Command
Center (1) and Tasks & Workflows (14) get their services and the shell entry
points, but their pages ship in Phase 2 (roadmap §5). Every module appears in the
launcher from the registry, with a designed empty state where its pages are not
built yet.

**Shared entities** (`packages/domain`, ERD `docs/data/erd.md`):
`Organization`, `Site`, `Department`, `Person` with `StaffAssignment`, `Requirement`
and `RequirementVersion` (global), `CatalogRelease` (global),
`RequirementInstance`, `ReadinessSnapshot`, `Evidence` and `EvidenceVersion`,
`EvidenceRequirementLink`, `Task`, `WorkflowDefinition`, `WorkflowRun`,
`Approval`, `Notification`, `AuditEvent` with `AuditChainHead`. New in Phase 1 for
identity: `UserAccount`, `AuthFactor`, `Session`, `IdpConnection`, `ScimToken`,
`RoleAssignment` (role, site scope, `valid_to` for auditors).

**Pages**

| Area | Pages (route) | Slice |
| --- | --- | --- |
| Auth (outside the shell) | Sign in `/sign-in` · Set up MFA `/sign-in/mfa/setup` · Verify MFA `/sign-in/mfa` · Recovery `/sign-in/recovery` · Sign in with your organization `/sign-in/sso` · Signed out `/sign-in?reason=signed-out` · Session expired `/sign-in?reason=expired` · Re-authentication dialog (modal on any page) | S1 (UI), S3 (wired) |
| Shell | Header, module bar, launcher / command palette, PREVIEW banner, language toggle, user menu, no-permission page, not-found, error | S1 |
| Command Center | Overview `/`, Today's priorities `/priorities`, Readiness briefs `/briefs`, Calendar `/calendar`, computed from the viewer's `requirement_instance` records (module map, "Command Center pages"); pulled forward from Phase 2, and the Phase 2 row and G2 still apply | S1, then S4b follow-up |
| Administration | Users & roles `/admin/users` · Organization & sites `/admin/org` · Requirements catalog `/admin/catalog` · Audit log `/admin/audit` · Integrations `/admin/integrations` (empty state until Phase 2) | S7 |
| Administration | Support access `/admin/support-access` (approve, deny, revoke, history) | S7b |
| Records (every module) | Record list `/<module>/<slug>` and record page `/<module>/<slug>/<id>` for each registered record type (ADR-0014 §3); first types: sites, users and role assignments, requirements (read-only), audit events (read-only) | S4b |
| Operator console (internal, `apps/console`) | Tenants · Support access · Catalog releases · Feature flags · Platform health · Operators (module map, "Operator console (internal)") | S7b |

The auth routes are not navigation, but routes are registry data: S1 adds an
"Auth routes (outside the shell)" section to `docs/product/module-map.md` and the
same entries to `packages/ui/module-registry.ts` in one change, reviewed by
`suite-architect`.

## 3. Build order

```
S0 contracts + spike ──┬─> S2 db ──> S3 api, auth, RBAC ──┬─> S5 tasks, approvals, notifications ─┐
S0b config, env matrix ┤              │                    ├─> S6 evidence, field encryption ──────┤
S1 shell+login, day 1 ─┤              │                    ├─> S4b records framework ──> S7 ───────┤
                       │              │                    ├─> S7 Administration pages <───────────┤
                       │              │                    └─> S7b operator console (after S5, S7) ┤
                       │              └─> S8 observability, log hygiene (closes after S6) ─────────┤
                       ├─> S4 dates (day 1) ─> catalog loader, readiness engine (after S2) ────────┤
                       └─> S9 AWS baseline IaC (parallel; deploys when the AWS org exists) ────────┴─> S10 G1 closure
```

S0b runs beside S0 and must land before S2's migration job and S3's `buildApp()`
read configuration. S4b (records framework, ADR-0014) starts when S3's policy engine,
audit middleware, and route manifest exist, uses S1's components, and lands before S7,
whose Administration pages are its first adopters; its evidence, tasks, and approvals
tabs light up as S5 and S6 land. S1 starts on day 1 against mocks. S7b starts once S7's Administration shell and S5's approval
service exist.

The login page is the first thing a reviewer can use: S1 builds it on a mocked
auth contract, S3 wires it to real sessions and MFA on the Netlify site.

## 4. Slices

Each slice lists its owners, inputs, outputs, the G1 checkboxes it proves (G1
numbering below), its dependencies, and a done-when. Every slice also meets the
definition of done in `CLAUDE.md`, and every PR records the
`hrsa-regulatory-analyst` verdict (or "non-regulatory, confirmed") and, where
personal data is touched, the `security-privacy-officer` verdict.

**G1 checkboxes** (roadmap §4): G1-1 tenant isolation · G1-2 authorization ·
G1-3 audit · G1-4 identity · G1-5 uploads · G1-6 logging hygiene · G1-7 no SSN ·
G1-8 readiness engine · G1-9 encryption (KMS) · G1-10 storage · G1-11 roles ·
G1-12 customer audit access · G1-13 PREVIEW banner · G1-14 accessibility ·
G1-15 internal security review.

### S0 · Contracts and runtime spike

- **Outputs:** ADR-0010 Accepted; ADR-0011 (tenancy naming) Accepted; spike report
  in the ADR-0010 PR; subprocessor rows for Neon and identity; `packages/domain`
  contracts for the shared entities (Zod), including `Permission`, `Role`,
  `AuditAction` registry skeleton.
- **G1:** none directly; unblocks all.
- **Depends on:** nothing. Runs in the first days, in parallel with S1.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `suite-architect` | Write ADR-0011 reconciling ADR-0002 and ADR-0008 names (`organization_id`, `app.organization_id`, `app_user`, `audit_writer`, `audit_retention`) | ADR-0002, ADR-0008, ERD, ADR-0010 §8 | Accepted by @jselvalugo; ADR-0002 and ADR-0008 carry a "see ADR-0011" note |
| `suite-architect` | Shared entity contracts in `packages/domain` (Zod + types), `Permission` and role catalogue from the module map, `AuditAction` registry file | Module map, ERD, ADR-0008 §4 | Types compile; `apps/web` and `apps/api` import them; unit tests on schema parsing |
| `platform-devops-engineer` | Spike: Fastify function at `/api/*` next to the Next.js runtime; scheduled function; Neon (Netlify DB) claimed, PG 16, US region; preview-branch wiring | ADR-0010 §1–§3, `netlify.toml` | Report answers each ADR-0010 follow-up; fallbacks chosen where needed |
| `data-architect` | Spike: on Neon, create `app_owner`, `app_user`, `app_platform`, `audit_writer`; prove `FORCE RLS` and fail-closed `current_setting` as `app_user` through the pooled endpoint | ADR-0002, ADR-0010 §2 | A script shows cross-tenant read fails and missing context errors on Neon |
| `security-privacy-officer` | Review ADR-0010; add Neon and "identity: in-house" rows to `docs/security/subprocessors.md`; answer the workforce-email question | ADR-0010, subprocessors.md | Review verdict recorded; rows merged |

### S0b · Config and environment matrix

- **Outputs:** ADR-0013 Accepted (roadmap D11); `@deemed/config/env` runtime module
  with a zod schema per deployable (`web` server, `api`, `api-platform`, `worker`,
  `console`), `loadConfig()` that fails closed and reports variable names only;
  `DH_ENV` refinements (production forbids dev keys, test IdP, capture adapters;
  non-production forbids `live` integrations); lint rule that only `packages/config`
  reads `process.env`; flag definitions file and evaluation function; Netlify context
  mapping (`deploy-preview` = `preview`, `production` = `development`, `dev` = `local`)
  and a build guard allowing only those values; CI jobs for the Neon branch per PR
  (from `seed-base`), ordered migrations (preview → development → staging →
  production) with owner credentials in GitHub environments only, seed refusal in
  production, and a nightly parity job; release workflow (tag, staging, human approval
  in the GitHub `production` environment).
- **G1:** G1-13 (banner driven by `DH_ENV` in every non-production environment,
  including previews), G1-1 (parity job re-checks forced RLS on every environment's
  database), G1-9 (production schema requires KMS configuration; `LocalKeyProvider`
  refused), G1-7 (seed and `check:no-ssn` in every environment's seed job).
- **Depends on:** S0 (ADR-0011 names; `parseDhEnv` in `packages/domain`). Blocks S2's
  migration job and S3's configuration loading. The staging column waits for S9.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `suite-architect` | Take ADR-0013 to acceptance; keep the matrix in sync with ADR-0005, ADR-0009, ADR-0010 | ADR-0013 | Accepted by @jselvalugo; roadmap D11 row updated |
| `backend-engineer` | `@deemed/config/env` schemas, `loadConfig()`, `process.env` lint rule, flag definitions and evaluation | ADR-0013 §3–§4 | Unit tests: missing, invalid, and production-forbidden variables stop startup with names only; unknown flag evaluates off; AI flags default off in every `DH_ENV` |
| `platform-devops-engineer` | `netlify.toml` context mapping, build guard values, Neon branch lifecycle, ordered migration jobs, parity job, release workflow with approval | ADR-0013 §1–§2, §5–§8; ADR-0010 §2 | A PR gets its own branch and `DH_ENV=preview`; a migration cannot reach development before its preview succeeded; Netlify holds no owner credentials (check); parity job fails on an injected drift |
| `data-architect` | Environment marker check at startup, seed refusal rules, migration checksum ledger | ADR-0013 §3, §5–§6 | Seed refuses a `production` marker or `DH_ENV`; API and worker stop when marker and `DH_ENV` differ |
| `qa-test-engineer` | PREVIEW banner E2E against every deployed non-production environment, including each deploy preview | ADR-0013 §7 | Banner test runs on preview and development deploys and names the environment |
| `security-privacy-officer` | Review secrets placement, access per environment, and the synthetic-only guards | ADR-0013 §1, §3, §6 | Verdict recorded in the ADR-0013 PR |

### S1 · Shell and login UI

- **Outputs:** `packages/ui` tokens (Tailwind preset from the design system),
  header, module bar, launcher / command palette, PREVIEW banner, status badges,
  empty / loading / error / no-permission states; `packages/ui/module-registry.ts`
  generated from the module map; `packages/i18n` EN/ES catalogs for shell and auth;
  `apps/web` auth pages and shell layout wired to a mocked auth client (typed on
  the S3 contract), Storybook with a story per state.
- **G1:** G1-13 (PREVIEW banner), G1-14 (accessibility, automated part).
- **Depends on:** S0 contracts for the registry and auth client types (can start
  on day 1 with a draft of the types).

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `design-system-engineer` | Tokens, Tailwind preset, header, module bar, launcher / command palette (Ctrl K), PREVIEW banner that cannot be dismissed, four page states | `docs/brand/design-system.md` §1–§8, module map | Stories render; axe clean; no hex values in components (lint) |
| `suite-architect` | `packages/ui/module-registry.ts` from the module map, including the auth routes section; permission key per page | Module map, S0 `Permission` | Registry test: every module-map row and route present; module map and registry updated in one PR |
| `ux-content-writer` | EN/ES strings for shell, auth, MFA enrollment, re-auth, errors (generic, no user enumeration), empty states | ADR-0006 rules 3, 5, 11; design system | Key parity check passes; no determination wording |
| `frontend-engineer` | `/sign-in`, `/sign-in/mfa/setup` (passkey first, TOTP second), `/sign-in/mfa`, `/sign-in/sso`, sign-out, expired state, re-auth dialog; shell layout; Overview empty state | S1 components, strings, mocked auth client | Playwright: flows pass in EN and ES against the mock; axe clean |
| `qa-test-engineer` | Playwright + axe harness; visual snapshots for shell and launcher; PREVIEW banner E2E | Test strategy §1 | Tests run in CI on every PR and against the Netlify preview |

### S2 · Database package

- **Outputs:** `packages/db`: Drizzle schema for the core entities and identity
  tables, hand-written SQL migrations with RLS in the same file as each tenant
  table, roles and grants, `withTenant(ctx, fn)`, the `audit` schema
  (`audit_event` partitioned monthly, `chain_head`, `action_registry`,
  `append_event` `SECURITY DEFINER`, UPDATE/DELETE/TRUNCATE trigger), the
  canonicalizer (`packages/domain/audit-canonical`) with golden files matched by
  the PL/pgSQL serializer, partition-ahead job function, synthetic seed
  (FX-ORG-XYZ with 3 sites, FX-ORG-330 and FX-ORG-LAL variants, personas);
  migration job in GitHub Actions against Neon.
- **G1:** G1-1 (database half), G1-3 (append-only privileges, hash chain,
  tamper detection), G1-7 (no SSN column; CI schema check).
- **Depends on:** S0 (ADR-0011, spike).

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `data-architect` | Drizzle schema, SQL migrations, RLS policies, roles and grants, `withTenant`, lint rule forbidding the raw client and session-level `SET` | ERD, ADR-0002, ADR-0011, S0 contracts | Migrations apply cleanly on Postgres 16 and on Neon; CI check fails a tenant table without a forced policy |
| `data-architect` | Audit schema, `append_event`, trigger, partitions, TypeScript and PL/pgSQL canonicalizers | ADR-0008 §1–§3 | Golden-file tests identical for both; chain verifies; editing one row fails verification at that `chain_seq` |
| `qa-test-engineer` | Tenant-isolation matrix discovered from `pg_catalog` (select/insert/update/delete cross-tenant, missing context errors, RLS forced); `has_table_privilege` test for `app_user` on audit | ADR-0002 rule 10, test strategy G1 rows | Suite runs on Testcontainers PG 16 per PR and on a Neon branch nightly; a new unprotected table fails |
| `data-architect` + `qa-test-engineer` | Synthetic seed from `packages/test-fixtures`; environment marker; seed refuses a `production` marker | Fixture plan §1–§2, ADR-0010 §2 | Seed runs in CI migration job; `check:no-ssn` passes over seed |
| `backend-engineer` + `security-privacy-officer` | Import column guard library (no endpoint yet): rejects SSN-named and SSN-shaped columns; schema lint that fails any table, Zod schema, or form field named like an SSN | Decision D1, G1 "No SSN" | Guard and lint tests pass; `check:no-ssn` covers seed and fixtures |
| `platform-devops-engineer` | GitHub Actions migration job (owner credentials in the `development` environment only), preview branch creation per S0 | ADR-0010 §2, §7 | Merge to `main` migrates and seeds the dev database; Netlify has `app_user` credentials only |

### S3 · API, authentication, and authorization

- **Outputs:** `apps/api` `buildApp()` with request context (request id,
  session, tenant), `withTenant` per request, audit middleware for every mutation
  and denied attempt, error model, route manifest; `netlify/functions/api.mts`
  and the fetch adapter; `packages/auth` (sessions, local accounts, passkeys,
  TOTP, re-auth, OIDC connector, SCIM stub, then SAML); `apps/test-idp`;
  RBAC policy engine in `packages/domain/policy` (roles from the module map, site
  scope, record rules, auditor end date, deny by default); `GET /api/me/navigation`
  so the launcher hides what the API denies; the S1 pages wired to the real API.
- **G1:** G1-1 (API half), G1-2, G1-3 (login, permission-change events),
  G1-4, G1-11.
- **Depends on:** S2. The policy engine's pure part can start after S0.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `backend-engineer` | Fastify skeleton, context, audit middleware (redaction from the column registry), route manifest that requires allowed / denied-role / other-site / other-tenant tests per endpoint, Netlify function entry, fetch adapter | ADR-0001, ADR-0008 §4–§5, ADR-0010 §1 | Manifest check fails any endpoint without the four tests; adapter unit tests pass; `/api/health` live on the Netlify preview |
| `backend-engineer` | `packages/auth`: sessions (15 min idle, 12 h absolute, rotation, tenant-bound), local accounts with Argon2id and breached-list check, mandatory passkey or TOTP, `requireRecentAuth` (5 min), throttling and lockout, MFA reset only by admin with step-up | ADR-0006 rules 2–5, 10–11; ADR-0010 §6 | Fake-clock tests: idle and absolute expiry, re-auth window; no code path issues a session without MFA; MFA cannot be disabled for any role |
| `backend-engineer` + `integrations-engineer` | OIDC connector with MFA step-up when `amr` lacks MFA; JIT users with no role; `apps/test-idp` on `oidc-provider`; SCIM stub; SAML connector last | ADR-0006 rules 1, 3, 6; ADR-0010 §6 | Test IdP login works in CI and on the dev site; SCIM `active=false` revokes sessions within 60 s (test); SAML either done or recorded as moved to Phase 2 |
| `backend-engineer` + `security-privacy-officer` | Policy engine: roles and page permissions from the registry, site scoping, record rules, auditor `valid_to` (max 30 days), deny by default; permission-change audit | Module map roles, ADR-0006 rule 7 | Policy unit tests per role; auditor access denied after end date (fake clock); denied paths audited with `outcome = denied` |
| `frontend-engineer` | Swap the mocked auth client for the API; server-side session check in the layout; re-auth dialog on 401 `reauth_required`; launcher from `/api/me/navigation` | S1 pages, S3 API | Playwright on the Netlify preview: synthetic persona signs in with TOTP and with a passkey (virtual authenticator), sees only permitted modules |
| `qa-test-engineer` | Identity and authorization integration suites; E2E for re-auth prompt | Test strategy G1 identity and authorization rows | Suites green in CI; counted in the G1 evidence index |

### S4 · Dates, catalog loader, readiness engine

- **Outputs:** `packages/dates` (UTC storage, `date` type, site and org time
  zones `America/New_York` and `America/Chicago`, cadence and lead-day math,
  business days); catalog compiler producing the non-production and production
  bundles, catalog publish job into global tables, production constraint rejecting
  non-`verified`; `packages/readiness` deterministic engine, `RequirementInstance`
  lifecycle, "Not applicable" with reason, `ReadinessSnapshot` pinned to
  `catalogVersion`; recompute job; first draft catalog entries for the engine to
  evaluate.
- **G1:** G1-8.
- **Depends on:** dates: nothing (day 1). Loader and engine: S2 (tables), S3
  (audit middleware for N/A and parameter changes).

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `backend-engineer` | `packages/dates` API and implementation | ADR-0001 layout, florida.md time zones | Leap years, month ends, DST edges, Eastern and Central fixtures (FX-DATE-*) pass; 100% branch coverage |
| `hrsa-regulatory-analyst` | Author a small set of **draft** entries covering each rule shape the engine must handle (expiration with lead days, periodic cadence, one-time document, board-approval-backed, tenant parameter with bounds, N/A allowed), each with `requirementId`, citation locator, `status: draft` | Framework §4, catalog schema, FX-CAT-* | Entries compile; none is `verified`; the production bundle is empty and the build says so |
| `backend-engineer` | Compiler bundles, publish job via `app_platform`, DB constraint on production catalog tables | ADR-0003 rules 3, 8, 11 | Publishing a draft into a production-marked database fails (test) |
| `backend-engineer` + `qa-test-engineer` | Readiness engine and recompute job; snapshots keep `catalogVersion` | ADR-0003 rule 4, test strategy G1 readiness row | Property-based determinism tests; snapshot tests; recompute enqueued transactionally and drained by `drain()` |
| `hrsa-regulatory-analyst` | Regulatory review of engine semantics and draft entries | S4 outputs | Verdict recorded in the PR |

### S4b · Records framework

- **Outputs:** ADR-0014 Accepted (roadmap D14). `packages/domain/src/records`
  (`defineRecordType`, registry, generated column classes from the data dictionary,
  registry test); `apps/api` generic record routes (list with filters, sort, search,
  keyset cursor, saved views; get; create; update with `If-Match` row version;
  transitions; archive and restore; bulk; history from `audit_event`; field reveal;
  CSV/XLSX export as a job; import with dry run and commit behind a flag that is off in
  every deployed environment); record rules compiled to SQL (`site_scope`, `own`,
  `assigned`, `not_self`, `state_lock`, `executive_area` fail-closed until D13 is
  accepted, `auditor_scope`); route manifest entries and generated four-case tests per
  record type; migrations for `row_version`, archive fields, `owner_person_id`,
  `saved_view`, `record_comment`, `record_evidence_link`, `task` subject columns,
  `record_import`, `record_export`, and the `audit_event` target index;
  `packages/ui/src/records` (`RecordTable`, `RecordPage`, `RecordForm`) with Storybook
  stories for every state; the module map "Record types" section and `RECORD_TYPES` in
  the module registry, launcher, and command palette; first record types `site`,
  `user_account`, `role_assignment`, `requirement` (read-only), `audit_event`
  (read-only).
- **G1:** G1-1 (generated other-tenant tests per record type), G1-2 (generated four-case
  route tests), G1-3 (every record mutation, reveal, export, import, and denial
  audited), G1-6 (export and import in the log-hygiene canary run), G1-7 (import runs the
  SSN guard; registry rejects SSN-like fields), G1-11 (site scope and record rules), G1-14
  (record components axe clean, keyboard bulk selection).
- **Depends on:** S1 (components), S2 (tables, `withTenant`, audit), S3 (policy engine,
  audit middleware, route manifest). Blocks S7. Tabs for evidence, tasks, and approvals
  need S5 and S6.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `suite-architect` | Take ADR-0014 to acceptance; `RecordType` types and registry in `packages/domain`; module map "Record types" section and `RECORD_TYPES` in `packages/ui/module-registry.ts` in one PR; add definition-of-done item 7 to `CLAUDE.md` | ADR-0014 §1, §3; module map | Accepted by @jselvalugo; registry test fails a type with no site scope, no fixture factory, an unclassified field, or a masked field marked filterable |
| `data-architect` | Migrations for row version (via `set_row_meta()`), archive fields, owner, `saved_view`, `record_comment`, `record_evidence_link`, task subject, import and export tables, `audit_event (organization_id, target_table, target_id, occurred_at)` index; column-classes generator; index check for sortable and filterable fields | ADR-0014 §2, §6; ERD; data dictionary | Migrations apply on PG 16 and Neon; every new table in the RLS matrix; stale generated classes fail CI; a sortable column without an index fails CI |
| `backend-engineer` | Generic record routes, record rules compiled to SQL and in memory, keyset cursor (HMAC), optimistic version with `409`, bulk, history, reveal, export job with formula-injection guard, import dry run and commit (flagged off), module hook points, generated audit actions | ADR-0014 §2, §4, §5; S3 policy engine; ADR-0008 §5 | Paging never returns an out-of-scope row (property test); out-of-scope `get` is `404`; stale `If-Match` is `409`; no `DELETE` route exists; bulk writes one event per row; import writes nothing on dry run |
| `design-system-engineer` | `RecordTable`, `RecordPage`, `RecordForm` and their parts (filter bar, column chooser, saved views menu, bulk bar, drawer, tabs, timeline, reveal dialog) on the tokens | ADR-0014 §3; design system §4.5, §5 | Stories for empty, loading, error, no-permission, archived, masked, and conflict states; axe clean; no hex values |
| `frontend-engineer` | Generic list and record routes in `apps/web` from the registry; UUID route matcher; command palette record actions and search | S4b components and API | Playwright EN and ES on `site` and `audit_event`: filter, sort, saved view, create in drawer, edit with a version conflict, archive and restore, history tab |
| `ux-content-writer` | EN/ES strings for the framework (filters, operators, bulk results, conflict, archive reason, reveal reason, import report, export notice) and label keys for the first record types | ADR-0014 §3; design system | Key parity check passes, including every `record.<type>.field.<field>` key in the registry |
| `qa-test-engineer` | Generated four-case suite per record type and action; fixture factories for the first types; scope-before-paging property test; export and import added to the S8 canary run; performance check at 10x seed volume | ADR-0014 §2.9; test strategy G1 rows | A new record type without a fixture factory or with a failing case fails CI; suites listed in the G1 evidence index |
| `security-privacy-officer` | Review masking, reveal, export, import, saved-view sharing, comment classification, and the auditor scope rule | ADR-0014 §2.7–§2.8, §4.5, §5 | Verdict recorded in the S4b PR; open questions in ADR-0014 answered |
| `hrsa-regulatory-analyst` | Review lifecycle and approval hooks, archive rules for regulatory records, and Sunshine flags | ADR-0014 §4.3, §4.6 | Verdict recorded |

### S5 · Tasks and approvals service, notifications, jobs

- **Outputs:** `packages/jobs` pg-boss adapter with transactional `send`;
  `apps/worker` handlers and `drain({ budgetMs })`; `netlify/functions/worker-tick.mts`
  (every 5 minutes); Tasks domain service (create, assign, due dates via
  `packages/dates`, link to `RequirementInstance`, workflow runs); Approval
  service (approver, role, timestamp, reason, approved object version, human
  actor only); Notification service (in-app records; email captured to the
  development outbox; no PII beyond the recipient's own name, no PHI).
- **G1:** G1-3 (approval events), G1-2 (endpoints), G1-11 (record rules on tasks).
- **Depends on:** S3, S4.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `backend-engineer` | Jobs package, worker handlers, drain, scheduled tick with singleton windows | ADR-0001 pg-boss section, ADR-0010 §3 | Job exists only if its transaction commits (test); tick stops at budget; handlers run under `withTenant` |
| `backend-engineer` | Tasks service and API; Approval service rejecting non-human actors and pinning the approved version | CLAUDE.md architectural rules, ERD | Service and API tests incl. four RBAC cases; AI/service actor approval rejected; version mismatch rejected |
| `backend-engineer` + `integrations-engineer` | Notifications: in-app store, email port with a capture adapter in non-production; template lint forbids PII fields other than recipient name | Roadmap §4 notifications row | No template can reference a restricted field (test); nothing is delivered outside production |
| `platform-devops-engineer` | Scheduled function deploy, alert on tick failures in the dev site logs | ADR-0010 §3 | Tick runs on the dev site; failures visible |
| `backend-engineer` + `security-privacy-officer` | Production delivery of MFA setup codes. An invitation or an administrator's MFA reset issues a single-use enrollment code (S3, `auth.enrollment_token`); outside production `admin.mfa.reset` returns it for synthetic personas, and in production it returns none (tested in S3). Deliver it out of band through the notification service to the user's own verified work email (template without other PII), or in person, and send the user the reset notice ADR-0006 rule 11 requires (today the audit event records it as pending) | ADR-0006 rules 3, 11; S3 enrollment tokens | Production MFA reset and invitation deliver the code only through the notification service (test with the capture adapter); no API response or log carries a code in production (test); delivery and the user notice are audited; the invitation endpoint (S7) uses the same path |

### S6 · Evidence store and field encryption

- **Outputs:** `packages/crypto` (envelope AES-256-GCM with AAD binding tenant,
  table, column, record id; blind index; `KeyProvider` with KMS and Local
  adapters); reveal endpoint with step-up and audit; `packages/evidence`
  (`ObjectStore` S3 port, presigned upload and download with short expiry,
  content-type sniffing, SHA-256, malware scan port, versioning, legal hold);
  Evidence and EvidenceVersion services.
- **G1:** G1-5, G1-10 (behavior on MinIO; configuration in S9), G1-3 (reveal and
  download events), G1-9 (library half).
- **Depends on:** S3. Deployed storage depends on S9.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `data-architect` | `packages/crypto`, blind-index columns for `person.dob`, key versioning, reveal audit | ADR-0007 rules 3–6, 8–9; ADR-0010 §5 | Ciphertext swapped between rows fails to decrypt (AAD test); `LocalKeyProvider` refuses `production` |
| `backend-engineer` | Evidence store, presign, scan port (ClamAV adapter for tests; AWS scanner adapter), content-type validation, legal hold | ADR-0002 rule 7, ADR-0010 §4 | EICAR rejected; spoofed type rejected; URL expiry (fake clock); delete under legal hold fails; all on MinIO in CI |
| `security-privacy-officer` | Choose the AWS scanner (tag-based) with `platform-devops-engineer`; review reveal flow | ADR-0010 §4 | Choice recorded in the S6 PR; verdict recorded |

### S7 · Administration pages

- **Outputs:** Users & roles (invite synthetic user, assign role and site scope,
  auditor with end date, reset MFA with step-up, deactivate), Organization &
  sites (Florida address and time-zone validation, award type display),
  Requirements catalog (read, draft badge, "last verified", source citation),
  Audit log (filter, view diff with redaction, export with re-auth and manifest,
  chain verification status), Integrations (empty state).
- **G1:** G1-12, G1-2 (admin endpoints), G1-3 (permission changes, export events),
  G1-11 (auditor expiry visible and enforced), G1-14.
- **Depends on:** S1, S3, S4 (catalog read), S4b (records framework: the pages
  are record types where they are lists), S2 (audit), S5 (notifications for MFA
  reset).

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `backend-engineer` | Admin APIs: users, roles, sites, catalog read, audit query and export (NDJSON canonical + CSV, signed manifest; development signing key via `KeyProvider`) | ADR-0006, ADR-0008 §6 | Four RBAC cases per endpoint; export writes an `export` event and needs re-auth |
| `ux-content-writer` | EN/ES copy, including "Draft, not verified" labels and audit field names | Design system, ADR-0003 rule 8 | Parity check passes; copy reviewed |
| `frontend-engineer` | The five pages on the shell with the four states | S1 components, S7 APIs | Playwright EN and ES; axe clean; tampered row shows as failed verification in the UI |
| `data-architect` | Offline verifier CLI for audit exports | ADR-0008 §2 | Verifies an untampered export; fails on a tampered one |
| `hrsa-regulatory-analyst` | Review catalog page wording and "last verified" display | Principle 3 | Verdict recorded |

### S7b · Operator console

- **Outputs:** ADR-0012 Accepted (roadmap D10); `apps/console` on its own origin
  (Netlify site in development) with workforce OIDC against a synthetic operator IdP
  in development, passkeys required, 10-minute idle and 4-hour absolute sessions,
  re-authentication for every write; the `/platform/*` API plugin mounted only on the
  console host; operator RBAC (`platform-admin`, `support`, `catalog-publisher`,
  `read-only-ops`); `app_platform` `SECURITY DEFINER` functions returning metadata and
  counts only, with the CI return-column check; tenant lifecycle (provision with Florida
  validation, suspend, reactivate, offboard to export; crypto-shred wired to
  `KeyProvider`, proven on KMS in `dh-nonprod` after S9); catalog release publishing
  through the S4 publish job; per-tenant feature flags; integration, job, and audit-chain
  health pages; support-access grants (`support_reader` role, scoped reads, dual-chain
  audit with `actor_type = 'support'`, revocation, expiry by database clock); break-glass
  with two-person approval and immediate customer notice; customer page
  **Administration › Support access** (`/admin/support-access`); module map and
  registry entries (`consoleModules` separate from the customer launcher).
- **G1:** G1-1 (support functions cannot cross tenants; `app_platform` cannot select
  tenant tables), G1-2 (console and support endpoints with allowed and denied role
  tests, including another tenant), G1-3 (every console write and every support read in
  the platform and tenant chains), G1-4 (operator MFA cannot be disabled; sessions
  expire; re-authentication), G1-11 (grants expire and revoke like the auditor role),
  G1-12 (customer sees support activity in its own audit log), G1-13 (banner on the
  console), G1-14 (console and support-access page axe clean), G1-15 (in the security
  review scope).
- **Depends on:** S0b (config for the console and `api-platform`), S3 (auth, RBAC,
  audit middleware), S4 (catalog publish job), S5 (Approval and Notification services),
  S7 (Administration shell and page patterns). Crypto-shred on real KMS depends on S9.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `suite-architect` | Take ADR-0012 to acceptance; module map and `packages/ui/module-registry.ts` (`consoleModules`, Administration › Support access) in one PR; audit action registry entries; ADR-0002 and ADR-0008 amendment notes | ADR-0012 | Accepted by @jselvalugo; registry test proves no console route in the customer launcher |
| `data-architect` | Platform tables, `support_access_grant` and `tenant_feature_flag` tenant tables with RLS, `support_reader` role, `app_platform` and support functions, CI return-column check, `actor_type = 'support'` | ADR-0012 §5–§8, ADR-0002, ADR-0008 | `app_platform` select on any tenant table fails; a function returning a PII column fails CI; grant checks happen in SQL |
| `backend-engineer` | `/platform/*` plugin, operator auth (workforce OIDC, passkeys, short sessions), operator RBAC, tenant lifecycle state machine, flag writes, job retry/discard, support grant request/approve/revoke/use, break-glass flow, notifications | ADR-0012 §1–§7, ADR-0006 | Four RBAC cases per endpoint; approval pins the grant version; support read writes two audit events; reveal and export under a grant fail; expired or revoked grant fails on the next call |
| `ux-content-writer` | EN/ES copy for the customer Support access page and notices (request, approval, first use, end, break-glass); console copy in English | ADR-0012 §6–§7 | Parity check passes for customer strings; notices name the operator, scope, and expiry |
| `frontend-engineer` | `apps/console` pages on the shell components; customer page `/admin/support-access` with the four states | S1 components, S7b APIs | Playwright: customer approves with re-auth, operator reads in scope, customer revokes and the console session ends; axe clean |
| `platform-devops-engineer` | Console Netlify site and, for AWS, the `api-platform` service, hostname, and WAF IP allowlist in IaC | ADR-0012 §1–§2, ADR-0013 | Console reachable only on its origin; no `app_platform` credential on the customer API |
| `qa-test-engineer` | Support-access isolation suite (other tenant, out-of-scope entity, expired, revoked), dual-chain audit assertions, operator identity tests | ADR-0012 Consequences | Suites green in CI and listed in the G1 evidence index |
| `security-privacy-officer` | Review guardrails, function allowlist, break-glass, and customer notices; threat model entries | ADR-0012 | Verdict Approve recorded |
| `hrsa-regulatory-analyst` | Review catalog publishing (verified-only) and that operators cannot approve or attest | ADR-0003, ADR-0012 §4.2, §6 | Verdict recorded |

### S8 · Observability and log hygiene

- **Outputs:** structured logger (pino) with correlation ids from the request
  context, a PII/PHI scrubber driven by the column registry, error handling that
  drops request bodies, OpenTelemetry traces with an in-memory exporter for tests,
  auth-anomaly signals (failed-login bursts, lockouts, break-glass) as structured
  security events; error-tracker choice recorded (no vendor receives data until a
  BAA per `subprocessors.md`).
- **G1:** G1-6.
- **Depends on:** S3 for the logger (added in the API skeleton); the G1-6 test
  closes after S6 so DOB and DEA canaries exist in encrypted fields.

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `backend-engineer` | Logger, scrubber, trace setup in API, worker, and functions | ADR-0008 §5, security policies | Every log line carries `request_id`; bodies never logged |
| `security-privacy-officer` + `backend-engineer` | Log-hygiene test seeding fake DOBs and DEA numbers through every API path, reveal, export, job, and error | Test strategy G1 logging row | No canary in logs, traces, error reports, or `audit_event` |
| `platform-devops-engineer` | Security events surfaced on the dev site's log drain; error-tracker decision with `security-privacy-officer` | Subprocessors | Decision recorded; alert on failed-login bursts works on the dev site |

### S9 · AWS baseline infrastructure (parallel)

- **Outputs:** infrastructure as code (tool per ADR-0005 §7) for the prod-shaped
  pieces G1 needs: per-environment KMS keys with rotation, evidence bucket
  (Block Public Access, versioning, SSE-KMS, Object Lock), RDS encryption and
  backups, SCP region lock; policy-as-code tests; `dh-nonprod` deploy of the
  evidence bucket and KMS key once the AWS organization exists.
- **G1:** G1-9, G1-10 (configuration).
- **Depends on:** nothing to start; the deploy step depends on the AWS
  organization (and the BAA acceptance tracked under G0).

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `platform-devops-engineer` | IaC modules and policy-as-code checks in CI | ADR-0005, ADR-0007, ADR-0008 §9 | Checks fail on an unencrypted bucket, missing rotation, or public access |
| `platform-devops-engineer` | Deploy the `dh-nonprod` evidence bucket and KMS key; set `DH_EVIDENCE_STORE=s3` on Netlify | ADR-0010 §4 | Synthetic upload works on the dev site; nightly configuration test passes on the deployed account |
| `security-privacy-officer` | Review key policies and bucket policies | ADR-0007 rule 5 | Verdict recorded |
| `platform-devops-engineer` + `backend-engineer` | Shared store for the API rate limiter (for example ElastiCache Redis). Today the limits count in each process's memory, keyed by IPv4 address or IPv6 /64; sign-in lockout is already shared (PostgreSQL) | ADR-0006 open items; S3 rate limiting | Required before production runs more than one API task: the limiter uses the shared store in production, and a test with two app instances on one store sees one budget |

### S10 · G1 closure

- **Outputs:** G1 evidence index (one row per checkbox: test name, CI run link, or
  signed document), manual keyboard and screen-reader scripts run, threat model
  updated with what was built, internal security review, sign-offs.
- **G1:** G1-14 (manual part), G1-15, and the evidence for all others.
- **Depends on:** S0b, S1–S9, S4b, S7b, and **G0 closed** (decision D9).

| Agent | Task | Inputs | Done when |
| --- | --- | --- | --- |
| `qa-test-engineer` | G1 evidence index; E2E sign-in to Administration journey in EN and ES; manual NVDA and VoiceOver scripts | Test strategy §2–§4 | Every G1 checkbox has evidence; thresholds met |
| `security-privacy-officer` | Internal security review of the platform; threat model update; risk analysis review | Threat model v1, S0–S9 PRs | Verdict Approve; documents signed |
| `hrsa-regulatory-analyst` | Sign-off on catalog and readiness engine | S4, S7 | Verdict Approve |
| `suite-architect` | Confirm G0 closed; collect sign-offs; update roadmap G1 checkboxes | Roadmap §3–§4 | G1 signed by `security-privacy-officer`, `qa-test-engineer`, `suite-architect`, `hrsa-regulatory-analyst` |

## 5. G1 coverage by slice

| G1 checkbox | Proven in | Where the proof runs |
| --- | --- | --- |
| G1-1 Tenant isolation | S2 (DB), S3 (API), S4b (per record type), S7b (support functions), S0b (parity) | CI Testcontainers; nightly Neon branch |
| G1-2 Authorization | S3, S4b, S5, S6, S7, S7b | CI (route manifest) |
| G1-3 Audit | S2, S3, S4b, S5, S6, S7, S7b | CI |
| G1-4 Identity | S3, S7b (operators) | CI (fake clock, test IdP); E2E on preview |
| G1-5 Uploads | S6 | CI (MinIO, ClamAV) |
| G1-6 Logging hygiene | S8 (incl. S4b export and import) | CI |
| G1-7 No SSN | S2 (schema lint, import column guard), S4b (import dry run, registry), S0 (contracts), S0b (seed jobs) | CI (`check:no-ssn`, schema lint, guard tests) |
| G1-8 Readiness engine | S4 | CI |
| G1-9 Encryption (KMS) | S9 (config), S6 (library), S0b (production config schema) | Policy-as-code in CI; nightly on `dh-nonprod` |
| G1-10 Storage | S6 (behavior), S9 (config) | CI (MinIO); `dh-nonprod` |
| G1-11 Roles | S3, S4b (record rules), S7, S7b (grant expiry) | CI (fake clock) |
| G1-12 Customer audit access | S7, S7b (support events) | CI + E2E |
| G1-13 PREVIEW banner | S1, S0b (every environment), S7b (console) | E2E on every non-production deploy |
| G1-14 Accessibility | S1, S4b, S7, S7b, S10 | CI axe; manual scripts |
| G1-15 Security review | S10 | Signed review |

Nothing in G1 is proven only on Netlify. The Netlify site is where reviewers see
the platform; CI and the AWS configuration tests are where G1 is proven
(ADR-0010, Consequences).

## 6. Risks and open questions

**Risks**

| Risk | Mitigation | Owner |
| --- | --- | --- |
| G0 does not close before the rest of G1 is ready | D9 makes it a hard precondition; S10 waits. The AWS BAA also unblocks S9's deploy step, so track it weekly | @jselvalugo, `suite-architect` |
| Netlify or Neon behaves differently from RDS (roles, RLS, pooler) | S0 spike; nightly Neon parity run; G1 proven on stock Postgres 16 | `data-architect`, `platform-devops-engineer` |
| Function path `/api/*` collides with the Next.js runtime | S0 spike; fallback is a `/_api/*` path with the same-origin cookie | `platform-devops-engineer` |
| Owning `packages/auth` is more code than a framework | Only session bookkeeping is ours; protocol libraries are maintained; `security-privacy-officer` reviews every auth PR; G4 pen test covers it | `backend-engineer`, `security-privacy-officer` |
| ADR-0002 and ADR-0008 naming drift leaks into migrations | ADR-0011 before S2's first migration | `suite-architect` |
| An `app_platform` function leaks PII to operators | CI return-column check against sensitivity classes; `security-privacy-officer` reviews every function | `data-architect`, `security-privacy-officer` |
| Customers do not answer support requests, so support stalls | Requests notify all administrators; break-glass for emergencies only; tenant opt-out is explicit | `suite-architect`, `ux-content-writer` |
| Neon branch per preview cannot be wired (ADR-0010 §2) | Fallback in ADR-0013 alternatives: shared development database with migration ordering | `platform-devops-engineer` |
| The synthetic-only rule is broken by a reviewer typing real data | PREVIEW banner, synthetic personas only, no importer, sign-up off; `security-privacy-officer` spot checks | `security-privacy-officer` |
| The records framework grows into a low-code engine, or a generic export leaks a field | Closed lists of field options, hooks, and record rules; export columns from the data dictionary display rule; canaries through export and import (ADR-0014) | `suite-architect`, `security-privacy-officer` |
| Import lets a reviewer load real data | Import flag off in every deployed environment until G4; CI uses synthetic fixtures only (ADR-0014 §2.8) | `backend-engineer`, `security-privacy-officer` |
| Readiness shown from draft entries is read as real | Draft badge everywhere; production bundle excludes drafts; "internal readiness" wording | `hrsa-regulatory-analyst`, `ux-content-writer` |

**For `hrsa-regulatory-analyst`**

- Which rule shapes must the first draft entries cover so the engine is not
  redesigned in Phase 2 (credential expiration, screening cadence, board approval
  with meeting link, FTCA annual items)?
- Confirm that showing draft entries in non-production Administration › Catalog
  with a "Draft, not verified" badge meets roadmap §2 rule 6.
- Catalog source verification is a G0 blocker; which sources are verified first so
  S4 fixtures cite real locators?
- Records framework (ADR-0014): which lifecycle transitions are approvals that need a
  catalog `approvalType`, and may board-approved records be archived or only superseded?

**For `security-privacy-officer`**

- May Loogo Labs workforce work emails be used as development logins, or only
  synthetic `.example` personas (ADR-0010 §2)?
- Is Neon via Netlify DB acceptable as a non-production subprocessor with no BAA,
  on the same terms as Netlify?
- Which AWS malware scanner for evidence (S6), and which error tracker for S8?
- Is an offline breached-password list acceptable in place of a live k-anonymity
  API call (ADR-0006 rule 2)?
- Support grants: is 4 hours the right maximum, and is individual audit of every
  support read (not only writes) the right level (ADR-0012 §6)?
- May support grants cover the tenant audit log (amending ADR-0008 §6), or should that
  remain break-glass only?
- Records framework (ADR-0014): may exports include list-visible PII (names, work
  email, NPI) with re-authentication alone? Should site-scoped roles see history events
  written at other sites? Default class of comments on non-PHI records?

## 7. ADRs

- **ADR-0010** Development runtime on Netlify (Proposed, this change).
- **ADR-0011** Tenancy naming reconciliation (to write in S0, before S2).
- **ADR-0012** Platform operator console and customer-approved support access
  (Proposed; roadmap D10; slice S7b).
- **ADR-0013** Environment management (Proposed; roadmap D11; slice S0b).
- **ADR-0014** Record management pattern (Proposed; roadmap D14; slice S4b).
- Revisit ADR-0010 when `dh-nonprod` exists or before G4.
