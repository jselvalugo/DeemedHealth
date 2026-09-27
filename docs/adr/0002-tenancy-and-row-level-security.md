# ADR-0002: Tenancy and row-level security

- Status: **Accepted** (@jselvalugo, 2026-09-27; roadmap D5)
- **Superseded in part by ADR-0011** (tenancy naming): the tenant column is
  `organization_id`, the setting is `app.organization_id`, object keys use
  `organizations/{organizationId}/`, and the role list adds `audit_writer` and
  `audit_retention`. Read `tenant_id` below as `organization_id`.
- Date: 2026-09-27
- Owner: `suite-architect`; reviewers `data-architect`, `security-privacy-officer`
- Related: ADR-0001, ADR-0005, ADR-0007, ADR-0008; `docs/compliance/florida.md` §1

## Context

Deemed Health is multi-tenant SaaS: each customer is a health center
(`Organization`) with one or more `Site`s. Tenants hold staff, provider, and
board PII and, later, limited PHI (FTCA incidents, grievances). The rules in
`CLAUDE.md` require tenant isolation **in the database** via RLS, not only in
application code, and role-based access with site scoping. Florida-only
operation (D4) constrains provisioning. The requirements catalog is global
reference data, not tenant data.

## Decision

1. **Tenant = Organization.** Shared database, shared schema. Every
   tenant-owned table has a non-null `tenant_id uuid` column referencing
   `organization(id)`, and it leads every tenant table's primary or unique
   indexes where useful (`(tenant_id, id)`).
2. **RLS on every tenant table**, with `ENABLE` and `FORCE ROW LEVEL SECURITY`.
   Standard policy:
   ```sql
   USING (tenant_id = current_setting('app.tenant_id')::uuid)
   WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)
   ```
   `current_setting` without the `missing_ok` flag raises if unset, so a query
   without tenant context fails closed instead of returning nothing silently.
3. **Database roles.**
   - `app_owner`: owns tables, runs migrations only; never used at runtime.
   - `app_user`: runtime role for `api` and `worker`; `NOBYPASSRLS`, no DDL,
     no `UPDATE`/`DELETE` on audit tables.
   - `app_platform`: narrowly scoped role for cross-tenant platform jobs
     (tenant provisioning, catalog publish, scheduled fan-out). It reads only
     the tenant list and writes only through `SECURITY DEFINER` functions that
     are reviewed by `security-privacy-officer`; every use is audited.
   - No runtime role has `BYPASSRLS`. Superuser is break-glass only (ADR-0006).
4. **Context per transaction.** `packages/db` exposes `withTenant(ctx, fn)`,
   which opens a transaction and sets `app.tenant_id`, `app.actor_id`, and
   `app.request_id` with `set_config(..., true)` (transaction-local, safe with
   pooling). All API requests and all jobs run through it. Connection poolers
   must run in transaction mode; session-level `SET` is forbidden (lint + test).
5. **Site scoping is app-layer RBAC over DB tenancy.** Tenant isolation is the
   hard boundary in the DB. Site-level and role-level restrictions are enforced
   in `apps/api` policy checks; for PHI tables (FTCA incidents, grievances) we
   additionally add an RLS predicate on `app.site_ids` / `app.roles` so the
   most sensitive rows get defense in depth.
6. **Global (non-tenant) tables** such as catalog versions, requirements,
   sources, and code lists have no `tenant_id`, are read-only to `app_user`, and
   are written only by the catalog publish job (ADR-0003). Tenant-specific
   overrides (e.g. a health-center policy interval, "Not applicable" with
   reason) live in tenant tables that reference the global rows.
7. **Object storage** keys are prefixed `tenants/{tenantId}/...`; presigned URLs
   are issued only by `apps/api` after an RLS-scoped lookup of the `Evidence`
   row. Per-tenant KMS keys or key context are decided in ADR-0007.
8. **Jobs** carry `tenantId`; a platform-level scheduler enumerates tenants via
   `app_platform` and enqueues one job per tenant. Workers never run tenant
   work outside `withTenant`.
9. **Provisioning (Florida-only).** Tenant creation validates that the
   organization and every site address are in Florida and that each site has a
   time zone of `America/New_York` or `America/Chicago`. A tenant's award type
   (§330 or Look-Alike) cannot be provisioned until its catalog entries are
   verified (FL-D2). Public-agency status is an organization setting (FL-D3).
10. **Tests are required.** A CI suite (owned by `qa-test-engineer`) creates two
    synthetic tenants and asserts, for every tenant table (discovered from
    `pg_catalog`), that cross-tenant select/insert/update/delete fails, that a
    missing context errors, and that every tenant table has RLS forced. A new
    table without a policy fails the build.

## Alternatives considered

- **Database per tenant.** Strongest isolation, but costly migrations, fan-out
  jobs, and catalog sync across many databases for a small-customer market.
  Revisit for a customer who contractually requires it.
- **Schema per tenant.** Similar operational cost; RLS gives equivalent
  isolation with one schema.
- **App-layer filtering only (`WHERE tenant_id = ?`).** Violates the stated
  rule; one missed filter leaks data.
- **RLS keyed on DB role per tenant.** Role sprawl and pool fragmentation;
  session variables with a single runtime role are simpler and auditable.

## Consequences

- Every query needs a transaction with tenant context; this is enforced by the
  `withTenant` helper and lint (ADR-0001).
- Cross-tenant analytics for Loogo Labs (usage, not content) use aggregated
  views through `app_platform` only and never expose PII.
- Slight query overhead from RLS predicates; mitigated by `tenant_id`-leading
  indexes.
- Moving a site between organizations is a controlled platform operation, not
  an ordinary update.
- Adding a non-Florida state requires a new decision and a change here.

## Status

Accepted by the product owner (@jselvalugo) on 2026-09-27. Superseded in part
(names only) by ADR-0011.
