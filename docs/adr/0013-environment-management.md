# ADR-0013: Environment management

- Status: **Proposed**
- Date: 2026-09-27
- Owners: `suite-architect`, `platform-devops-engineer`
- Reviewers required: `data-architect` (migrations, seed, parity), `security-privacy-officer`
  (secrets, synthetic-only, access), `qa-test-engineer` (parity and banner tests), product
  owner (@jselvalugo, roadmap decision D11)
- Reconciles: ADR-0005 §4–§6 (AWS local / preview / staging / production) with ADR-0009 and
  ADR-0010 (Netlify for non-production)
- Amends, on acceptance: ADR-0009 guardrail "`DH_ENV=development` for every context" (see §2);
  ADR-0005 §4 table (replaced by §1 here). Production rules in ADR-0005 are unchanged.
- Related: ADR-0001 (`packages/config`), ADR-0002, ADR-0003, ADR-0007, ADR-0012; roadmap §2
  rules 1 and 3, decision D7, D9

## Context

ADR-0005 defined four AWS environments. ADR-0009 moved non-production web deploys to Netlify
with `DH_ENV=development` everywhere, and ADR-0010 added Neon, a scheduled worker, and
Netlify-specific configuration. The product owner asked that the application be manageable
across multiple environments. Today there is no single place that says, per environment, where
it runs, what data it holds, which secrets it has, how code and schema move between
environments, or who can reach it. `packages/domain/src/environment.ts` already lists
`local | preview | development | staging | production`, but every Netlify context sets
`development`, so a per-PR preview cannot be told apart from the shared development site.

## Decision

### 1. Environment matrix

| | local | preview (per PR) | development | staging | production |
| --- | --- | --- | --- | --- | --- |
| **Purpose** | One developer | Review one PR | Shared, always-latest `main` | Release rehearsal on production-shaped infrastructure | Customers |
| **Host** | Developer machine (`pnpm dev`; Docker Compose) | Netlify deploy preview (web, console site, API and worker functions) | Netlify production context of the dev sites (main branch) | AWS `dh-nonprod` (ECS), once it exists (S9); until then, not deployed | AWS `dh-prod` (ECS on Fargate), ADR-0005 |
| **Database** | Postgres 16 in Docker; Testcontainers for tests | Own Neon branch per PR, created from the `seed-base` branch, deleted when the PR closes | Separate Neon database (`development` branch), not a parent of previews | RDS PostgreSQL 16 in `dh-nonprod` | RDS PostgreSQL 16 Multi-AZ in `dh-prod` |
| **Object storage** | MinIO (versioning, object lock) | `off` until `dh-nonprod` exists; then the non-production bucket under `previews/pr-<n>/` | `off`, then the non-production bucket (governance-mode lock) | Non-production bucket in `dh-nonprod` | S3 with SSE-KMS and Object Lock compliance mode |
| **Keys** | `LocalKeyProvider` | `LocalKeyProvider` (per-context dev roots) | `LocalKeyProvider` | KMS, non-production keys | KMS, per-tenant keys (ADR-0007) |
| **Secrets** | Untracked `.env.local` from `.env.example`; synthetic values only | Netlify env vars scoped to the `deploy-preview` context; sandbox only | Netlify env vars scoped to the `production` context of the dev site; sandbox only | Secrets Manager `/dh/staging/...` | Secrets Manager `/dh/production/...` |
| **`DH_ENV`** | `local` | `preview` | `development` | `staging` | `production` |
| **Data policy** | Synthetic seed only | Synthetic seed only | Synthetic seed only | Synthetic seed only | Customer data after G4; seed refused |
| **Integrations mode** | `stub` | `stub` | `stub`, or `sandbox` per integration | `sandbox` | `live` |
| **Email and SMS** | Captured to the local outbox | Captured to the outbox table; never delivered | Captured; never delivered | Captured, or delivered only to the allowlisted `.example` test domain | Delivered through the BAA-covered provider |
| **Deploy trigger** | Manual | Every PR push (Netlify) plus the CI migrate-and-seed job | Merge to `main` (CI migrates first, then Netlify deploys) | Release tag (§6) | Same tag, after human approval in the GitHub `production` environment |
| **Who can access** | The developer | Loogo Labs workforce and invited reviewers behind Netlify team login or password; synthetic personas | Same as preview | Loogo Labs workforce through IAM Identity Center with MFA | Customer users (SSO + MFA); Loogo Labs operators only through the console and support grants (ADR-0012) |
| **PREVIEW banner** | Yes | Yes | Yes | Yes | No |

- "Development/staging" in earlier documents means the **development** column until
  `dh-nonprod` exists; after that, **staging** is the release gate and development remains the
  integration site.
- `apps/console` (ADR-0012) follows the same matrix on its own site or hostname.

### 2. Netlify contexts to `DH_ENV`

| Netlify context | `DH_ENV` |
| --- | --- |
| `production` (main branch of the dev sites) | `development` |
| `deploy-preview` | `preview` |
| `branch-deploy` | Turned off. If turned on later, `preview` with its own Neon branch |
| `dev` (`netlify dev`) | `local` |

`DH_ENV` is never `production` on Netlify (ADR-0009 guard unchanged). The build guard also
rejects any value other than `local`, `preview`, or `development` on Netlify.

### 3. Typed configuration: `packages/config`

- `@deemed/config` gains a runtime module `@deemed/config/env` alongside its tooling presets.
  Each deployable (`web` server, `api`, `api-platform`, `worker`, `console` server) declares a
  **zod** schema; `loadConfig('<app>')` validates `process.env` once at startup.
- **Fails closed.** A missing, extra-for-production, or invalid variable stops the process with
  a non-zero exit and an error that lists variable **names**, never values.
- Schemas refine by `DH_ENV`:
  - `production`: requires KMS key ARNs, `INTEGRATIONS_MODE=live`, and the BAA email provider;
    forbids `DH_DEV_*` keys, the test IdP, `LocalKeyProvider`, and the outbox capture adapter.
  - Non-production: requires `INTEGRATIONS_MODE` of `stub` or `sandbox`; integration clients
    refuse live endpoints; forbids any secret whose name marks it as production.
  - Browser-exposed values: only an allowlist of `NEXT_PUBLIC_*` keys, none secret (lint).
- Only `packages/config` reads `process.env` (lint rule). Files under `netlify/` translate
  Netlify variables (`CONTEXT`, `URL`) before calling it (ADR-0010 portability rule).
- `DH_ENV` parsing reuses `parseDhEnv` from `packages/domain/src/environment.ts`.
- The database marker (ADR-0010 §2, `platform.environment_marker`) must equal `DH_ENV` at API
  and worker startup, or the process stops.

### 4. Feature flags per environment and per tenant

- **Definitions** live in the repository (`packages/config/flags.ts`): key, kind (`release`,
  `ops`, `entitlement`, `kill-switch`), owner, default per `DH_ENV`, and a removal date for
  release flags. CI fails on an expired release flag.
- **Environment values:** each environment's database holds `platform.feature_flag`, seeded from
  the definitions by the migration job, changeable only through the console (ADR-0012) and
  audited.
- **Tenant values:** `tenant_feature_flag` (tenant table, RLS, read-only to `app_user`) written
  only by `app_platform` functions, audited in the platform and tenant chains.
- **Evaluation:** environment kill switch off → off; else tenant value; else environment value;
  else definition default; unknown flag → off.
- **AI capabilities are off by default** in every environment and tenant (ADR-0004, ADR-0012
  §4.3). Flags never grant a permission, bypass RBAC, or unlock a non-verified catalog entry.

### 5. Migrations

- One migration set, forward-only in production, written expand-then-contract so the previous
  release keeps working during a deploy.
- **Promotion order through CI only:** preview branch (on each PR) → development (on merge) →
  staging (on release tag) → production (same tag, after approval). A migration cannot run in
  an environment until it has succeeded in the previous one for the same commit.
- Migrations run as `app_owner` from GitHub Actions using GitHub environment secrets
  (`preview`, `development`) or OIDC to AWS Secrets Manager (`staging`, `production`).
  **Owner credentials are never set on Netlify** or in any runtime.
- Each environment records the applied migration ids and checksums; parity (§8) compares them.

### 6. Seed and release promotion

- **Seed:** synthetic only, from `packages/test-fixtures`, every row `is_test_record = true`,
  `check:no-ssn` passing. The seed refuses to run when `DH_ENV=production`, when the database
  marker is `production`, or when the target account is `dh-prod`.
- **Release:** a semantic version tag on a `main` commit that is green and deployed to
  development. CI builds the artifacts once (container images pinned by digest, migration
  bundle hash, catalog bundle version), deploys to staging, runs the smoke and parity suites,
  and waits for a **human approval** in the GitHub `production` environment by a reviewer other
  than the tag author. Rollback is a redeploy of the previous tag; no down migrations.

### 7. PREVIEW banner

Every non-production environment (`local`, `preview`, `development`, `staging`) renders the
amber, non-dismissable PREVIEW banner on every page of `apps/web` and `apps/console`, with the
environment name. An E2E test runs against every deployed non-production environment (G1-13).

### 8. Parity checks

A nightly CI job and the pre-promotion step compare each environment with the expected state
and fail promotion on drift: migration ids and checksums; RLS enabled and forced on every
tenant table; role privileges (`has_table_privilege` matrix for `app_user`, `app_platform`,
`support_reader`, audit roles); Postgres major version and extensions; flag definitions; config
schema version; catalog bundle version; Node version; `DH_ENV` equal to the database marker.

## Alternatives considered

- **Keep `DH_ENV=development` for all Netlify contexts.** Simple, but previews and the shared
  site are indistinguishable in logs, flags, and parity checks. Rejected.
- **Previews share the development database.** Cheaper, but schema changes collide and review
  data leaks between PRs. Rejected; fallback only if S0 shows Neon branching cannot be wired
  (ADR-0010 §2).
- **Feature flag vendor (LaunchDarkly and similar).** Another subprocessor that would receive
  tenant identifiers; the flag set is small. Rejected for now.
- **Migrations in the Netlify build.** Puts owner credentials in the build. Rejected (ADR-0010).
- **Plain `process.env` reads.** No fail-closed guarantee. Rejected.

## Consequences

- Five environments with one matrix; changes to any row need an amendment to this ADR.
- Neon branch cost per open PR; branches are deleted on close and after 7 days idle.
- Staging does not exist until `dh-nonprod`; until then the development site is the last stop
  before production, which is acceptable only because production does not exist before G4.
- **Follow-ups (no code change in this ADR):**
  - `netlify.toml`: set `DH_ENV=preview` for `deploy-preview` and `local` for `dev`;
    `scripts/assert-non-production.mjs` rejects values outside `local | preview | development`.
  - `packages/domain/src/environment.ts` already lists all five values, so no amendment is
    needed. If ADR-0011's `packages/domain` changes alter that file, reconcile there.
  - `packages/config` description and exports updated for the runtime module.
  - CI jobs for Neon branch lifecycle, ordered migrations, parity, and release approval
    (`platform-devops-engineer`).

## Status

Proposed by `suite-architect` on 2026-09-27. Needs review by `platform-devops-engineer`,
`data-architect`, `security-privacy-officer`, and `qa-test-engineer`, and acceptance by the
product owner (@jselvalugo) as roadmap decision D11.
