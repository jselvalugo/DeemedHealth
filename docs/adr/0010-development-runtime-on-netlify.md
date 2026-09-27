# ADR-0010: Development runtime on Netlify

- Status: **Proposed**
- Date: 2026-09-27
- Owner: `suite-architect`
- Reviewers required: `platform-devops-engineer` (runtime, deploys), `data-architect`
  (database, roles), `security-privacy-officer` (auth, subprocessors, synthetic-only
  guarantees), product owner (@jselvalugo, decision D5)
- Answers: ADR-0009 consequence "hosting for `apps/api` and `apps/worker` in
  non-production needs a follow-up decision"; ADR-0006 open item "identity vendor
  vs. library choice"
- Amends: ADR-0005 §4, **for non-production only** (development database, jobs, and
  object storage outside `dh-nonprod`). ADR-0001 boundaries are unchanged.
- Related: ADR-0001, ADR-0002, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009;
  roadmap §2 rule 1, §4 (Phase 1, G1), decision D9

## Context

The product owner asked to begin building the platform, from the login page
through the whole platform core (roadmap Phase 1). ADR-0009 put the web app's
non-production deploys on Netlify but left the rest of the ADR-0001 architecture
(`apps/api`, `apps/worker`, Postgres, object storage, identity) without a
non-production home. The AWS `dh-nonprod` account does not exist yet, and G0 is
still open on the AWS BAA, the training record, and catalog source verification
(decision D9). Phase 1 therefore starts on Netlify with synthetic data only.

Forces:

- **Production does not change.** ADR-0005 stays authoritative for production:
  ECS on Fargate, RDS for PostgreSQL, S3 with Object Lock, KMS, Secrets Manager.
  Whatever runs on Netlify must be the same code, with only thin adapters at the
  edges, so nothing has to be rewritten for AWS.
- **ADR-0001 boundaries hold.** `apps/web` never touches the database; `apps/api`
  owns sessions, RBAC, domain services, and the audit middleware; `apps/worker`
  runs jobs. A development convenience must not blur that line, or the G1 tests
  would prove a different system from the one that ships.
- **ADR-0002 must be real in development.** RLS with `FORCE`, the three runtime
  roles, a transaction-mode pooler, and `set_config(..., true)` have to behave on
  the development database exactly as in the test database and RDS.
- **Synthetic data only, forever** outside production (roadmap §2 rule 1,
  ADR-0009). No vendor used here is under a BAA.
- **Netlify limits.** Functions are request-scoped (synchronous functions time out
  at tens of seconds, request bodies are limited to about 6 MB), there is no
  long-running process, and scheduled functions run at most once a minute.
- **Small team.** Fewest moving parts that still prove G1.

## Decision

### 1. API: the Fastify app runs as one Netlify Function

- `apps/api` stays a Fastify application, as ADR-0001 decided. Its composition
  root is `buildApp(deps): FastifyInstance` in `apps/api/src/app.ts`, with no
  knowledge of where it runs. Every domain rule lives in `packages/domain` and the
  service packages, never in a handler.
- Two thin entry points call `buildApp`:
  - `apps/api/src/server.ts` calls `listen()`. It is the entry point for local
    development and for the production container on ECS (ADR-0005).
  - `netlify/functions/api.mts` is a Netlify Function (Functions API v2, Web
    `Request`/`Response`) with `config.path = "/api/*"`. It builds the app once per
    function instance and forwards each request through a small, tested adapter
    (`apps/api/src/adapters/fetch.ts`) that maps a Web `Request` to
    `app.inject()` and back.
- The API is served on the **same origin** as the web app (`/api/*`). The
  host-prefixed session cookie from ADR-0006 (`__Host-` prefix, `Secure`,
  `HttpOnly`, `SameSite=Lax`) therefore works without CORS, and CSRF protection is
  an origin check plus a per-session token on mutating requests.
- Next.js server components and server actions call the API over HTTP, forwarding
  the session cookie and the `x-request-id` header. `apps/web` contains no
  `app/api` routes and does not import `db`, `jobs`, `audit`, or `auth` internals
  (ESLint boundaries rule, ADR-0001).
- Evidence files never pass through the function: uploads and downloads use
  presigned URLs (§4), so the request-body limit does not apply to them.
- **Portability rule.** Only files under `netlify/` may import `@netlify/*`
  packages or read Netlify-specific variables (`NETLIFY`, `CONTEXT`, `URL`,
  `DEPLOY_PRIME_URL`). A lint rule enforces it. Moving to AWS means deleting
  `netlify/`, not editing packages.

### 2. Development Postgres: Netlify DB (Neon), synthetic only

- The development database is **Netlify DB, which is Neon Postgres**, pinned to
  **PostgreSQL 16** to match the test containers and RDS, in an AWS US-East
  region. The database is claimed into a Loogo Labs–owned Neon account on day one
  so it does not expire and so ownership and access are controlled by Loogo Labs.
- **Roles follow ADR-0002** (names as reconciled in ADR-0011, §8 below):
  - `app_owner` runs migrations only. Its credentials live in the GitHub
    `development` environment and are used by the migration job, never by the
    Netlify build or runtime.
  - `app_user` (`NOBYPASSRLS`, no DDL, no UPDATE/DELETE on the audit schema) is the
    only role whose connection string is set on the Netlify runtime.
  - `app_platform` for the scheduler fan-out and provisioning, through
    `SECURITY DEFINER` functions only.
  - `audit_writer` owns `audit.append_event` (ADR-0008).
  Neon's default `neon_superuser` role can bypass RLS, so it is treated like the
  AWS break-glass superuser: never used by the app, never used in tests.
- **Connections.** The API uses Neon's pooled endpoint (PgBouncer in transaction
  mode), which is exactly the pooler mode ADR-0002 requires, with a pool of one
  connection per function instance. `withTenant` sets `app.organization_id`,
  `app.actor_id`, and `app.request_id` with `set_config(..., true)` inside every
  transaction. Migrations and the job drain (§3) use the direct (unpooled)
  endpoint.
- **Migrations run in CI, not in the Netlify build.** A GitHub Actions job runs
  `drizzle-kit migrate` plus the hand-written RLS SQL as `app_owner`, then seeds
  from `packages/test-fixtures`. The Netlify build never holds owner credentials.
- **Preview databases.** Each deploy preview gets its own Neon branch, migrated and
  seeded with synthetic data, if Netlify DB or the Neon GitHub integration can
  wire the branch URL into the preview context. If S0 shows that it cannot,
  previews share the development branch and a migration that is not backward
  compatible merges only after the previews that depend on the old schema close.
- **Synthetic-only guards.**
  - The seed writes a `platform.environment_marker` row (`development`). The API
    refuses to start if `DH_ENV=production` and the marker is not `production`, and
    the seed refuses to run if the marker is `production` (ADR-0005 §5 rule applied
    to the database).
  - Every seeded record carries `is_test_record = true` (`docs/qa/fixture-plan.md`).
  - Self-service sign-up is off. Accounts are seeded synthetic personas
    (`compliance.officer@xyz-chc.example`, `.example` domain only). Reviewers use
    them through the team password manager and register their own passkey or TOTP.
    Whether Loogo Labs workforce work emails may be used instead is an open
    question for `security-privacy-officer`; until answered, they may not.
  - No import endpoint is exposed in Phase 1. The import column guard that rejects
    SSN-shaped columns is built and tested as a library (G1 "No SSN"), and the
    Phase 4 importer refuses to load customer files where the marker is not
    `production`.
- **Tests stay on local Postgres 16.** The G1 integration suites run in CI against
  Testcontainers Postgres 16 with RLS on and a non-superuser role (ADR-0001,
  `docs/qa/test-strategy.md`). A nightly job also runs the tenant-isolation and
  audit-privilege matrices against a throwaway Neon branch, so a difference
  between Neon and stock Postgres fails loudly.

### 3. Jobs: pg-boss, drained by a scheduled function in development

- `packages/jobs` exposes the queue interface from ADR-0001 with a pg-boss
  adapter. Enqueue stays transactional: services call `jobs.send()` with the
  current `withTenant` transaction as pg-boss's executor, so a job exists only if
  the change that caused it commits.
- Job handlers live in `apps/worker/src/handlers/` as plain functions
  `(job, ctx) => Promise<void>` that open their own `withTenant` transaction from
  the job's `tenantId` and `actorId`. They know nothing about the host.
- Hosts:
  - **Local and AWS:** `apps/worker/src/main.ts` runs `boss.start()` as a
    long-running process (the ECS worker service in production).
  - **Netlify development:** there is no long-running worker. A **scheduled
    function** `netlify/functions/worker-tick.mts` runs every 5 minutes. It
    (1) enqueues recurring jobs whose window is due, using a singleton key per
    window (this replaces pg-boss cron, which needs a supervising process), and
    (2) drains queues with `fetch`, runs handlers, and marks each job
    complete or failed, stopping at a 20-second budget so it never exceeds the
    function limit. Unfinished work waits for the next tick.
  - A job that cannot finish in one tick is split into per-tenant or per-batch
    jobs. Netlify background functions are not used in Phase 1; if a Phase 2
    integration needs one, it is added by amendment.
- The same `drain({ budgetMs })` entry point is what integration tests call, so
  job behavior is deterministic in CI.
- **Deferred in development:** external anchoring of the audit chain (ADR-0008
  §9) needs S3 Object Lock in a separate AWS account, so in development the
  anchor sink is a no-op that records `anchoring disabled (development)` as a
  platform `system` event. Hash-chain verification (hourly) runs in development.

### 4. Evidence storage: S3 API only; no Netlify Blobs

- `packages/evidence` talks to object storage through an `ObjectStore` port whose
  only production-grade adapter is the **S3 API** (`@aws-sdk/client-s3` and the
  presigner): versioning, SSE-KMS, Object Lock legal hold, Block Public Access,
  and presigned URLs with short expiry.
- **Tests:** MinIO in Testcontainers, with versioning and object lock on, proves
  the G1 upload and storage behaviors (EICAR rejection with a ClamAV container,
  spoofed content type, URL expiry with a fake clock, legal hold blocks delete).
- **Deployed development:** an S3 bucket in the AWS `dh-nonprod` account (synthetic
  only, Object Lock in *governance* mode so non-production buckets can be torn
  down; production uses compliance mode per ADR-0008), created by the S9
  infrastructure-as-code slice. Malware scanning on AWS uses an S3-triggered
  scanner that tags objects; the API presigns a download only for objects tagged
  clean. The scanner service is confirmed in S6 with `security-privacy-officer`.
- **Until `dh-nonprod` exists,** evidence upload on the Netlify deploy is switched
  off by configuration and returns a designed "storage not configured in this
  environment" state. Nothing else in Phase 1 depends on a deployed bucket.
- **Netlify Blobs is not used for evidence.** It has no presigned URLs, object
  versioning, legal hold, or customer-managed keys, so it cannot prove any G1
  storage item and would add a second code path that production never runs.

### 5. Field encryption keys in development

- `packages/crypto` implements ADR-0007 envelope encryption behind a
  `KeyProvider` port. On AWS, the provider is KMS with a per-tenant key (or key
  context). Locally, in CI, and on Netlify, a `LocalKeyProvider` derives a
  per-tenant key with HKDF from a development root key held in a Netlify
  environment variable (functions scope only, never `NEXT_PUBLIC_`), and a
  separate root for blind indexes.
- `LocalKeyProvider` refuses to load when `DH_ENV=production` (tested). The G1
  encryption checkbox (KMS keys and rotation) is proven by configuration tests on
  the S9 infrastructure code, not on Netlify.

### 6. Identity: our own `packages/auth`, built on maintained protocol libraries

This choice applies to **every environment, including production**. It resolves
ADR-0006's open item "identity vendor vs. library": no identity vendor is added
as a subprocessor.

- **Sessions (our code, small and fully specified by ADR-0006).** Opaque 256-bit
  random tokens; only a SHA-256 of the token is stored, in `auth.session`, with
  `organization_id`, `user_id`, `created_at`, `last_seen_at`, `mfa_at`,
  `reauth_at`, and `revoked_at`. 15-minute idle and 12-hour absolute timeouts
  (tenant may shorten); rotation on login and privilege change; one tenant per
  session. Re-authentication freshness is `now - reauth_at <= 5 minutes`, checked
  by a `requireRecentAuth` route option. Deprovisioning sets `revoked_at` for all
  of a user's sessions in the same transaction.
- **Maintained libraries for everything cryptographic or protocol-shaped** (no
  custom crypto, ADR-0007 rule 9):

  | Concern | Library |
  | --- | --- |
  | Passwords (local accounts) | `@node-rs/argon2` (Argon2id); breached-password check against an offline k-anonymity range list shipped with the build, so no password material leaves the platform |
  | Passkeys / WebAuthn | `@simplewebauthn/server` and `@simplewebauthn/browser` |
  | TOTP | `otpauth` (RFC 6238), secrets field-encrypted with `packages/crypto` |
  | OIDC relying party | `openid-client` (OpenID-certified) with PKCE, `state`, and `nonce` |
  | SAML 2.0 service provider | `@node-saml/node-saml`, signed assertions required, replay cache in Postgres |
  | Test OIDC provider | `oidc-provider` |

- **Order of delivery** (ADR-0006 requires federation; Phase 1 builds it in this
  order):
  1. **Local accounts with mandatory MFA.** Email and password, then passkey or
     TOTP enrollment before any other page is reachable. There is no code path
     that creates a session without an MFA factor, and no setting that turns MFA
     off. SMS and email one-time codes do not exist.
  2. **OIDC connector** per tenant (Entra ID and Google Workspace shapes). If the
     IdP does not assert MFA (`amr`/`acr`), the user steps up with our passkey or
     TOTP. JIT-provisioned users get no role.
  3. **SCIM 2.0 stub**: `/api/scim/v2/Users` with a per-tenant bearer token
     (hashed at rest), supporting create, `active=false`, and delete, each of which
     revokes sessions within 60 seconds. Groups and filtering beyond `userName eq`
     come later.
  4. **SAML connector** last in Phase 1; it does not gate any G1 checkbox, so if it
     slips it moves to early Phase 2 and `suite-architect` records that in the plan.
- **Test IdP.** `apps/test-idp` wraps `oidc-provider` with synthetic personas and
  switchable `amr` values (with and without MFA). It runs in-process in CI tests,
  as a local process in development, and as a Netlify Function at
  `/test-idp/*` on the development site only. The production build excludes it,
  and it refuses to start when `DH_ENV=production`.
- **Abuse controls without Redis.** Rate limits and progressive lockout are kept
  in a Postgres table (`auth.throttle`) keyed by account and by IP prefix, with
  generic error messages (ADR-0006 rule 11).
- **Audit.** Every auth event in ADR-0008 §4 (`session.login`,
  `session.login_failed`, `session.reauth`, `mfa.enrolled`,
  `scim.user_deprovisioned`, and the rest) is written through `audit.append_event`
  in the same transaction as the session change.
- **Email in development** (invitations, MFA reset notices) is captured to a
  development outbox table and never delivered (ADR-0005 §4).

### 7. Configuration and secrets on Netlify

| Variable | Scope | Holds |
| --- | --- | --- |
| `DH_ENV` | build and functions | Always `development` (ADR-0009) |
| `DATABASE_URL` | functions | Pooled `app_user` connection |
| `DATABASE_URL_UNPOOLED` | functions (`worker-tick` only) | Direct `app_user` connection for pg-boss |
| `DATABASE_URL_PLATFORM` | functions (`worker-tick` only) | `app_platform` connection for fan-out |
| `DH_DEV_ROOT_KEY`, `DH_DEV_BIDX_KEY` | functions | Development key roots (§5); synthetic only |
| `DH_EVIDENCE_STORE` | functions | `off` or `s3` (§4) |

Owner credentials are never set on Netlify. No secret uses a `NEXT_PUBLIC_`
prefix. Functions run in a US region, co-located with the Neon region.

### 8. Naming prerequisite (ADR-0011)

ADR-0002 names the tenant column `tenant_id`, the setting `app.tenant_id`, and the
runtime role `app_user`. ADR-0008, `docs/data/erd.md`, and roadmap §4 use
`organization_id`, `app.organization_id`, and `app_rw`. Both ADRs are Accepted, so
the difference is resolved in a short ADR-0011 before slice S2 writes the first
migration. This ADR assumes the proposed resolution: column `organization_id`,
setting `app.organization_id`, runtime role `app_user` (ADR-0008's `app_rw` means
`app_user`), with `audit_writer` and `audit_retention` added to ADR-0002's role
list.

### 9. What stays AWS-only

Production (all of it), KMS keys and rotation, S3 Object Lock in compliance mode,
the audit anchor bucket and RFC 3161 timestamps, AWS Backup, and GuardDuty. G1
items that depend on these (encryption configuration, storage configuration) are
proven on the infrastructure code and the `dh-nonprod` account, never on Netlify.

## Alternatives considered

- **Next.js route handlers or server actions calling `packages/domain` and `db`
  directly.** One deployable fewer on Netlify, but it reverses ADR-0001's accepted
  service boundary, puts database credentials and RBAC inside the web bundle, and
  means the G1 authorization and audit tests would exercise a different entry
  point from the one production runs. Rejected.
- **Fastify on Netlify through `@fastify/aws-lambda` and the Lambda-compatible
  function signature.** Works, but ties the dev entry point to Netlify's legacy
  function mode and loses v2 path routing. The `inject` adapter is about forty
  lines and fully tested. Kept as the fallback if S0 finds a problem.
- **API on another host (Render, Fly.io, Railway) next to Netlify.** Gives a
  long-running worker, but adds a vendor, a second origin (CORS and cross-site
  cookies), and a second deploy pipeline. Rejected for now.
- **Supabase as the development database.** RLS-friendly, but brings its own auth,
  roles (`anon`, `authenticated`), and API conventions that invite shortcuts
  around ADR-0002 and ADR-0006. Rejected.
- **A development RDS instance now.** Closest to production, but blocked until the
  AWS organization exists and costs more for idle development. Revisit when S9
  lands; Neon remains acceptable for synthetic data after that.
- **Netlify Blobs for evidence.** See §4. Rejected.
- **Defer the worker entirely in development.** Simpler, but readiness recompute
  and notifications would never run on the reviewable site. The scheduled drain is
  small and uses the same handlers.
- **Better Auth, Auth.js, or Lucia as the identity framework.** Better Auth covers
  passkeys, TOTP, and SSO through plugins, but it owns its own session and account
  tables and semantics, which would have to be bent to ADR-0006's tenant-bound
  sessions, 5-minute step-up, SCIM revocation, and same-transaction audit, and
  kept under our RLS rules. Auth.js has weak MFA support; Lucia is deprecated as a
  library. Composing protocol libraries under our own session store keeps those
  rules in one place we test. Revisit if the maintenance cost of `packages/auth`
  grows.
- **A hosted identity vendor (Amazon Cognito, Auth0, WorkOS) or self-hosted
  Keycloak or Zitadel.** A vendor becomes a subprocessor holding names and emails,
  may need a BAA, and Cognito cannot be reached before the AWS organization
  exists. A self-hosted IdP is another service to run, patch, and secure, and
  cannot run on Netlify. Rejected for Phase 1.
- **Building the protocols ourselves.** ADR-0006 rejects in-house auth end to end,
  and ADR-0007 forbids custom crypto. Only session bookkeeping is ours.

## Consequences

- One code base serves both hosts. Netlify-specific code is limited to
  `netlify/functions/*` (API, worker tick, test IdP) and is removed for AWS.
- The G1 test suites run on Testcontainers in CI; the Netlify site is where
  reviewers see the result, not where G1 is proven. The nightly Neon parity run
  catches drift between the two.
- Jobs in development can lag by up to 5 minutes. That is acceptable for synthetic
  data and is documented on the development site's help page.
- Cold starts on the API function add latency to the first request after idle;
  acceptable for development only.
- Evidence upload is not available on the Netlify site until `dh-nonprod` exists.
- **Layout additions to ADR-0001:** `packages/auth`, `packages/crypto`,
  `packages/evidence`, `apps/test-idp`, and the root `netlify/functions/`
  directory. Only `apps/api` and `apps/worker` may import `auth`, `crypto`, and
  `evidence` (same rule as `db`); `apps/web` may not. `apps/test-idp` is a
  development-only deployable and is never built for production.
- **New subprocessor rows** (`security-privacy-officer`, before S2 deploys): Neon
  through Netlify DB, non-production, synthetic only, no BAA, never PII or PHI. The
  identity row becomes "none: in-house `packages/auth` on maintained libraries".
- **Follow-ups:** ADR-0011 (naming), S0 verification spike (function path
  precedence over the Next.js runtime, Neon role creation and `FORCE RLS` as
  `app_user`, preview-branch wiring, pg-boss over the direct endpoint), and a
  revisit of this ADR when `dh-nonprod` exists or before G4, whichever comes
  first.

## Status

Proposed by `suite-architect` on 2026-09-27. Needs review by
`platform-devops-engineer`, `data-architect`, and `security-privacy-officer`, and
acceptance by the product owner (@jselvalugo).
