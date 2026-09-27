# ADR-0005: Hosting, environments, and regions

- Status: Proposed
- Date: 2026-09-27
- Owners: `suite-architect`, `platform-devops-engineer`
- Reviewers required: `security-privacy-officer` (BAA, subprocessors), product owner (@jselvalugo, decision D5)
- Related: roadmap §2 (rules 1, 3, 7), §3 (Phase 0), §13 (D1, D3, D4); `docs/compliance/florida.md` (§1 Hosting, FL-PRIV-3); ADR-0001, ADR-0007

## Context

Deemed Health will store staff, board, provider, and organizational data for
Florida health centers, and a small amount of minimized PHI (for example
grievance narratives). The roadmap requires:

- a HIPAA-eligible cloud covered by a signed BAA before any customer data (G0, G4);
- US-only processing (`florida.md` §1 and FL-PRIV-3, Fla. Stat. §408.051 pending counsel);
- synthetic data only outside production, forever, and an amber PREVIEW banner
  in every non-production environment (roadmap §2 rule 1);
- CI that blocks and never warns (roadmap §2 rule 3).

We need to fix where the system runs, how environments are separated, how the
code knows which environment it is in, and where secrets live, before Phase 1
code is written.

## Decision

### 1. Cloud provider and BAA

- Host on **AWS**, using only services on the AWS HIPAA Eligible Services list.
  The AWS Business Associate Addendum is accepted through AWS Artifact for the
  **production** organization and account before any customer data is loaded.
  (The BAA is also accepted for non-production accounts, even though they hold
  synthetic data only, so a mistaken copy is still covered.)
- Core services (all HIPAA-eligible): VPC, ECS on Fargate (containers pinned by
  digest), RDS for PostgreSQL (Multi-AZ in production), S3 (versioned, SSE-KMS,
  Block Public Access on), SQS, KMS, Secrets Manager, CloudWatch, CloudTrail,
  Route 53, ACM, WAF, and AWS Backup.
- Every vendor is recorded in `docs/security/subprocessors.md` with its BAA
  status before it touches customer data (owned with `security-privacy-officer`).
- Any service not on the eligible list, or any vendor without a BAA, may be used
  only in non-production with synthetic data, and only after it is listed.

### 2. Regions

- **Primary region: `us-east-1`** (N. Virginia). **Backup and DR region:
  `us-east-2`** (Ohio). Cross-region backup copies stay in the US.
- An AWS Organizations **Service Control Policy** denies all actions outside
  `us-east-1` and `us-east-2` (except the global services IAM, Route 53,
  CloudFront, and Organizations that require `us-east-1`).
- Every subprocessor that handles customer data, including the AI provider
  (ADR-0004) and error tracking, must process it in the US. This is our planning
  assumption for FL-PRIV-3; counsel confirms per decision D3.

### 3. Accounts

An AWS Organization with separate accounts. Production is isolated from
everything else by an account boundary, not only by IAM policy.

| Account | Holds | Customer data |
| --- | --- | --- |
| `dh-management` | Organizations, SCPs, billing, IAM Identity Center | None |
| `dh-security` | Org CloudTrail, Config, GuardDuty, Security Hub, log archive (S3 Object Lock) | Logs only (no PII/PHI by logging policy) |
| `dh-nonprod` | Preview and staging | **Never.** Synthetic only |
| `dh-prod` | Production | Yes, after G4 |
| `dh-backup` | AWS Backup vault copies (vault lock, compliance mode) | Encrypted copies of production |

- No IAM role, KMS key grant, VPC peering, or S3 bucket policy allows `dh-nonprod`
  to read from `dh-prod` or `dh-backup`. **Production data is never copied down.**
- Humans reach accounts through IAM Identity Center with MFA; production access
  is just-in-time and logged. CI deploys through GitHub OIDC federation (no
  long-lived keys), with separate roles per account; the production role trusts
  only the protected `production` GitHub environment.

### 4. Environments

| Environment | Where | Data | `DH_ENV` | Integrations | Deploy trigger |
| --- | --- | --- | --- | --- | --- |
| local | Developer machine (Docker Compose Postgres, MinIO, local queue) | Synthetic seed from `packages/test-fixtures` | `local` | Stubbed | `pnpm dev` |
| preview | `dh-nonprod`, one ephemeral stack per PR, destroyed on close | Synthetic seed | `preview` | Stubs or vendor sandboxes; email/SMS captured, never delivered | Every PR |
| staging | `dh-nonprod`, long-lived | Synthetic seed | `staging` | Vendor sandboxes only | Merge to `main` |
| production | `dh-prod` | Customer data (after G4) | `production` | Real | Tagged release plus human approval in the GitHub `production` environment |

Synthetic data is owned by `qa-test-engineer` and `data-architect`. It never
contains SSN-shaped values (decision D1; enforced by `scripts/check-no-ssn.mjs`
in CI).

### 5. `DH_ENV` and the PREVIEW banner

- `DH_ENV` is a required server-side variable with values `local | preview |
  staging | production`. The apps **fail to start** if it is missing or invalid.
  It is set by infrastructure as code, never by hand.
- **Safe default:** code treats anything other than the exact string
  `production` as non-production. So a missing or wrong setting fails toward
  the banner and toward blocked integrations, never toward real ones.
- When `DH_ENV !== "production"`:
  - the web shell renders the amber **PREVIEW** banner from
    `docs/brand/design-system.md` §4 on every page, and it cannot be dismissed;
  - outbound integrations (screening sources, email, SMS, AI with real data)
    use sandboxes or stubs; the integration clients refuse real endpoints;
  - seeding from the synthetic data set is allowed.
- When `DH_ENV === "production"`: seed scripts refuse to run, and the deploy
  pipeline checks that the target account ID is `dh-prod`. A production
  `DH_ENV` value in a non-production account fails the deploy.
- The value is exposed to the browser only as a derived boolean for the banner,
  never alongside any secret.

### 6. Secrets

- **AWS Secrets Manager** per account, with names prefixed by environment
  (`/dh/{env}/...`) and encrypted with a per-environment KMS key (ADR-0007).
- Workloads read secrets at runtime through their task role. No secrets in the
  repository, in `.env` files that are committed, in CI logs, in container
  images, or in client bundles. Only `NEXT_PUBLIC_*` values reach the browser,
  and those are never secrets (lint rule to be added in Phase 1).
- CI uses GitHub OIDC to assume a deploy role; GitHub secrets hold no cloud keys.
- gitleaks runs on every PR; GitHub secret scanning and push protection are on.
- Rotation: automatic rotation for database credentials (30 days in production),
  and a manual rotation runbook for third-party API keys at
  `docs/runbooks/secret-rotation.md` (to write in Phase 1).

### 7. Infrastructure as code

All accounts, networks, databases, buckets, queues, KMS keys, DNS, and SCPs are
defined in version control (tool chosen in ADR-0001 follow-up; Terraform or
AWS CDK in TypeScript) and reviewed like code. Console-only changes are not
allowed; AWS Config drift findings are alerts.

## Alternatives considered

- **Google Cloud or Azure.** Both offer a BAA and HIPAA-eligible services.
  AWS was chosen for the breadth of eligible managed services, Organizations SCPs
  for region locking, and team familiarity. Not a compliance difference.
- **A PaaS (Vercel, Render, Heroku).** Faster to start, but BAA coverage is
  limited to specific plans, region control is weaker, and account separation
  is harder to prove. Could be reconsidered for the marketing site only.
- **One account with IAM separation between environments.** Cheaper, but a
  single policy mistake could expose production data to non-production. Rejected.
- **Single region with no DR region.** Rejected; the RPO/RTO ADR needs a
  cross-region copy.

## Consequences

- The hosting BAA must be signed and recorded before G0 closes.
- Preview stacks cost money per open PR; they are torn down on close and after
  7 days idle.
- Developers need AWS access only for nonprod; production access is rare and audited.
- Every integration client must implement a sandbox or stub path from day one.
- Follow-ups: ADR for RPO/RTO and restore drills; `docs/runbooks/secret-rotation.md`;
  `docs/security/subprocessors.md` entry for AWS and GitHub.

## Open items

- Counsel (D3) confirms that US-only hosting satisfies Fla. Stat. §408.051
  (FL-PRIV-3) for a business associate.
- Confirm that the chosen AI provider path (ADR-0004) processes in the US under a BAA.
