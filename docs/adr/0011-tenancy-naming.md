# ADR-0011: Tenancy naming

- Status: **Accepted** (@jselvalugo, 2026-09-27)
- Date: 2026-09-27
- Owner: `suite-architect`; reviewers `data-architect`, `security-privacy-officer`
- Supersedes in part: ADR-0002 §1, §2, §3, §4, §7 (names only); ADR-0008 §1, §6
  (names only)
- Related: ADR-0001, ADR-0007, ADR-0010 §2 and §8; `docs/data/erd.md`;
  `docs/product/phase-1-plan.md` S0

## Context

Two Accepted ADRs name the same things differently:

| Thing | ADR-0002 | ADR-0008, ERD, roadmap §4 |
| --- | --- | --- |
| Tenant column | `tenant_id` | `organization_id` |
| Transaction setting | `app.tenant_id` | `app.organization_id` |
| Runtime database role | `app_user` | `app_rw` |
| Audit function owner | (not listed) | `audit_writer` |
| Retention role | (not listed) | `audit_retention` |

ADR-0001 (the `set_config` example), ADR-0007 (encryption context), and the
threat model (TN-1) also say `tenant_id` / `app.tenant_id`. Slice S2 writes the
first migration, RLS policies, and grants, so one set of names has to be fixed
before it starts. ADR-0010 §8 proposed the resolution below; the product owner
approved it by merging PR #5 and asking the team to continue.

## Decision

1. **Tenant column: `organization_id uuid NOT NULL`**, referencing
   `organization(id)`, on every tenant-owned table, including the `audit`
   schema. It matches the domain name (`Organization` is the tenant) and the ERD.
   Indexes lead with it where useful: `(organization_id, id)`.
2. **Transaction settings:** `app.organization_id`, `app.actor_id`,
   `app.request_id`, set by `withTenant(ctx, fn)` with `set_config(..., true)`.
   The PHI defense-in-depth predicates from ADR-0002 §5 use `app.site_ids` and
   `app.roles`. The standard policy becomes:
   ```sql
   USING (organization_id = current_setting('app.organization_id')::uuid)
   WITH CHECK (organization_id = current_setting('app.organization_id')::uuid)
   ```
   `current_setting` without `missing_ok` still fails closed.
3. **Database roles**, the complete list. No other login role is created by
   migrations.

   | Role | Login | Purpose |
   | --- | --- | --- |
   | `app_owner` | yes | Owns schemas and tables; runs migrations only; never used at runtime. |
   | `app_user` | yes | The only runtime role for `api` and `worker` (ADR-0008's `app_rw` means `app_user`). `NOBYPASSRLS`, no DDL, `INSERT`/`SELECT` only on the `audit` schema, and audit inserts only through `audit.append_event`. |
   | `app_platform` | yes | Cross-tenant platform jobs (provisioning, catalog publish, scheduler fan-out) through reviewed `SECURITY DEFINER` functions only. `NOBYPASSRLS`. |
   | `audit_writer` | no | Owns `audit.append_event` and `audit.chain_head`; nobody connects as it. |
   | `audit_retention` | yes | Retention job only (ADR-0008 §8): detach and drop audit partitions, write checkpoints. Credentials in the secret manager, never given to `api`. |

   No runtime role has `BYPASSRLS`. Superuser and Neon's `neon_superuser` stay
   break-glass only.
4. **TypeScript names** follow the column: `organizationId` in `packages/domain`
   contracts, job payloads, request context, and object keys
   (`organizations/{organizationId}/...` replaces `tenants/{tenantId}/...`). The
   word "tenant" stays acceptable in prose and helper names (`withTenant`).
5. **Encryption context** (ADR-0007) binds `organization_id`, table, column, and
   record id.
6. Everything else in ADR-0002 and ADR-0008 is unchanged.

## Alternatives considered

- **Keep `tenant_id` everywhere (ADR-0002).** Generic, but the ERD, ADR-0008, the
  audit table DDL, and roadmap §4 already use `organization_id`, so more text
  would change, and "tenant" is not a domain word customers use.
- **Keep `app_rw` (ADR-0008).** `app_user` is already in ADR-0002 and ADR-0010,
  and the S0 Neon spike is written against it.
- **Leave both and alias.** Two names for one column or role invites a missed
  policy or a wrong grant; the CI checks in ADR-0002 §10 need one name.

## Consequences

- S2 migrations, RLS policies, grants, and the tenant-isolation test suite use
  only the names above. A CI check may reject `tenant_id` and `app_rw` in SQL.
- ADR-0002 and ADR-0008 carry a "Superseded in part by ADR-0011" note; their
  text is otherwise left as accepted.
- References to update when their owners next touch them: ADR-0001 (the
  `set_config` example), ADR-0007 Decision (encryption context wording), and
  `docs/security/threat-model.md` TN-1 (`security-privacy-officer`).
- `packages/domain` exports `DB_ROLES` and `TENANT_SETTING` so application code
  and tests do not spell these names by hand.

## Status

Accepted by the product owner (@jselvalugo) on 2026-09-27, by merging PR #5
(which carried the proposal in ADR-0010 §8) and asking the team to continue.
