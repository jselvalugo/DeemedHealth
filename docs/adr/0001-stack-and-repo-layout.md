# ADR-0001: Stack and repository layout

- Status: **Proposed** (only the product owner, @jselvalugo, accepts; roadmap D5)
- Date: 2026-09-27
- Owner: `suite-architect`
- Related: ADR-0002 (tenancy and RLS), ADR-0003 (catalog), ADR-0004 (AI gateway), ADR-0005 (hosting), ADR-0008 (audit log); roadmap §2 and §3

## Context

`CLAUDE.md` proposes a TypeScript monorepo with Next.js, PostgreSQL with row-level
security (RLS), "Prisma or Drizzle", a job queue, S3-compatible object storage,
SSO + MFA, and the Claude API behind a server-side gateway. Phase 0 of the
roadmap requires this ADR to confirm or amend that stack before Phase 1 code is
written, so that code is secure by default.

Forces:

- **Tenant isolation is enforced in the database** (RLS), not only in the app.
  The ORM must let every request run inside a transaction that sets the tenant
  and actor context (`SET LOCAL` / `set_config(..., true)`) and must not hide
  the SQL we need for policies, roles, and grants (ADR-0002).
- **Requirements are data.** The catalog is versioned YAML compiled into
  typed data and seeded into Postgres (ADR-0003).
- **The audit log is append-only** and written by shared middleware (ADR-0008).
- **Jobs** (monthly screening, expiration scans, notifications, catalog
  re-evaluation) must be enqueued atomically with the data change that causes
  them, must carry tenant context, and must not add a datastore that needs its
  own BAA and encryption story.
- **Synthetic data only** until G4, from a shared fixtures package.
- Small team; minimize moving parts.

## Decision

### Stack (confirmed, with the amendments marked)

| Layer | Choice |
| --- | --- |
| Language / tooling | TypeScript (strict), Node.js LTS, pnpm workspaces, **Turborepo** for task orchestration and caching (amendment: adds a build runner) |
| Web | Next.js (App Router), React, Tailwind CSS generated from the tokens in `docs/brand/design-system.md`, Lucide icons |
| API | **Separate `apps/api` service** (Fastify) exposing typed HTTP endpoints; Next.js server code calls it and never touches the database directly (amendment: fixes the service boundary) |
| Validation / contracts | Zod schemas in `packages/domain`, shared by web, API, and workers |
| Database | PostgreSQL 16+, with RLS on every tenant table (ADR-0002) |
| ORM / migrations | **Drizzle ORM + drizzle-kit, with hand-written SQL migrations for RLS** (see below) |
| Job queue | **pg-boss** (Postgres-backed) running in `apps/worker` |
| Object storage | S3-compatible, SSE-KMS, versioning and Object Lock on the evidence bucket; uploads via short-lived presigned URLs; malware scan before an object is readable |
| Auth | OIDC/SAML SSO + MFA via a HIPAA-eligible identity provider (chosen in ADR-0006); sessions validated in `apps/api` |
| AI | Claude API behind `packages/ai-gateway` (ADR-0004) |
| i18n | ICU message catalogs, EN default, ES from day one (FL-D1) |
| Testing | Vitest (unit/integration against a real Postgres via Testcontainers), Playwright + axe (E2E, accessibility) |

#### Drizzle over Prisma

Drizzle is chosen because it is the more RLS-friendly of the two:

1. **Transaction-scoped tenant context is first-class.** Drizzle runs on a plain
   `pg`/`postgres` connection; `db.transaction(tx => { tx.execute(sql\`select set_config('app.tenant_id', ${id}, true)\`); ... })`
   keeps every query of the request on one connection inside one transaction.
   Prisma routes queries through its query engine and connection pool; making
   `SET LOCAL` reliable requires wrapping every call in interactive
   transactions or client extensions, which is easy to get wrong silently.
2. **SQL is visible.** Policies, `FORCE ROW LEVEL SECURITY`, role grants,
   security-definer functions, and audit triggers are written as reviewed SQL
   migrations that sit alongside Drizzle's generated ones. Prisma's schema
   language cannot express them and they end up as unmanaged raw SQL anyway.
3. **No separate engine binary** to pin, scan, and ship in images.

Cost accepted: less "batteries included" than Prisma (no Studio-style tooling;
relations are more manual). Rule: generated migrations are reviewed, and every
tenant table migration must include its RLS policy in the same file (CI check,
ADR-0002).

#### pg-boss as the job queue

- Jobs are rows in the same Postgres, so **enqueue is transactional** with the
  change that causes it (no lost or phantom jobs, no outbox needed for the MVP).
- **No extra datastore** (Redis) to host under the BAA, encrypt, back up, and
  add to the subprocessor list.
- Supports scheduling (cron), retries with backoff, singleton keys (one screening
  run per tenant per cycle), and dead-letter queues.
- Every job payload carries `tenantId` and `actorId` (a system actor for
  scheduled jobs); the worker opens its own RLS-scoped transaction with it
  (ADR-0002). Payloads carry IDs only, never PII.

Revisit (new ADR) if sustained throughput exceeds what one Postgres comfortably
serves; the queue sits behind a `packages/jobs` interface so it can be swapped.

### Workspace layout

```
DeemedHealth/
├─ apps/
│  ├─ web/                    # Next.js App Router UI (shell, module pages). No DB access.
│  ├─ api/                    # Fastify HTTP API: auth/session, RBAC, domain services, audit middleware
│  └─ worker/                 # pg-boss workers: screening, expirations, readiness recompute, notifications
├─ packages/
│  ├─ domain/                 # Shared entities + Zod contracts: Organization, Site, Person, Requirement,
│  │                          #   RequirementInstance, Evidence, Task, Approval, AuditEvent, Notification
│  ├─ db/                     # Drizzle schema, SQL migrations (incl. RLS policies), withTenant() helper
│  ├─ requirements-catalog/   # Catalog schema, YAML entries, source register, compiler + validators (ADR-0003)
│  ├─ readiness/              # Readiness engine: recompute RequirementInstance status from evidence
│  ├─ dates/                  # The one due-date/time-zone package (UTC storage, America/New_York + America/Chicago)
│  ├─ jobs/                   # Queue interface + pg-boss adapter, job type registry
│  ├─ audit/                  # Audit event writer used by API middleware and workers (ADR-0008)
│  ├─ ai-gateway/             # Server-only Claude gateway, redaction, guardrails, eval hooks (ADR-0004)
│  ├─ integrations/           # Adapters: LEIE, SAM.gov, NPPES, FL DOH MQA, AHCA sanctions, CAQH
│  ├─ i18n/                   # EN/ES message catalogs and helpers
│  ├─ ui/                     # Design-system components, tokens, shell, module-registry.ts
│  ├─ config/                 # Shared tsconfig, eslint, tailwind preset, vitest config
│  └─ test-fixtures/          # Synthetic data only: tenants (both award types, both FL time zones),
│                             #   people, catalog snapshots, clock fixtures, SSN-shaped negatives
├─ docs/                      # Product, compliance, brand, security, ADRs
├─ assets/brand/
├─ .claude/agents/
├─ pnpm-workspace.yaml
└─ turbo.json
```

Dependency rules (enforced by lint, e.g. `eslint-plugin-boundaries`):

- `apps/web` may import `ui`, `domain`, `i18n`, `dates`; never `db`, `jobs`,
  `ai-gateway`, `integrations`.
- Only `apps/api` and `apps/worker` import `db`, `jobs`, `audit`, `ai-gateway`,
  `integrations`.
- `domain`, `dates`, and `requirements-catalog` have no runtime dependency on
  `db` (pure logic, easy to test).
- `test-fixtures` is a devDependency only; a CI check fails any production
  bundle that includes it.

## Alternatives considered

- **Prisma.** Better DX and tooling; rejected for the RLS reasons above.
  Would be reconsidered only if Drizzle lacked a needed capability.
- **Kysely or raw SQL.** Equally RLS-friendly, but less schema/migration
  tooling; Drizzle gives the same SQL control with typed schema.
- **BullMQ on Redis.** Mature and fast, but adds a datastore under the BAA, a
  non-transactional enqueue (would need an outbox), and more ops. Not needed at
  MVP volume.
- **Temporal / managed workflow engines.** Powerful for long workflows; too
  heavy for Phase 1 and another subprocessor. Revisit for complex approvals.
- **Cloud-native queues (SQS etc.).** Non-transactional with Postgres; ties to
  one cloud before ADR-0005.
- **Next.js route handlers as the only backend.** Fewer services, but mixes UI
  and data access, makes worker reuse awkward, and blurs the audit/RBAC boundary.

## Consequences

- One Postgres holds data, RLS policies, jobs, and (per ADR-0008) the audit
  log; its backup, encryption, and HA story (ADR-0005/0007) covers all of them.
- Every DB access goes through `packages/db`'s `withTenant()` helper; a lint
  rule forbids importing the raw client elsewhere.
- Three deployables (`web`, `api`, `worker`) to build, sign, and pin (roadmap §3).
- `packages/dates` is the only place due-date math lives; `qa-test-engineer`
  owns its leap-year, month-end, DST, and Eastern/Central fixtures.
- `packages/test-fixtures` is the only source of data in non-production.
- Changing the ORM or queue later requires a superseding ADR.

## Status

Proposed. Awaiting acceptance by the product owner (@jselvalugo).
