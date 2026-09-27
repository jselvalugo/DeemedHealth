# Deemed Health — FQHC Compliance Suite

Deemed Health is FQHC compliance software built by Loogo Labs. It gives a
Federally Qualified Health Center (and Look-Alike) one place to see where it
stands against the HRSA Health Center Program requirements **every day, not
only at the Operational Site Visit**: who is credentialed and privileged, who is
enrolled with which payer, who was screened against exclusion lists, what the
board approved, which evidence is missing, and what is due next.

Logo: `assets/brand/deemed-health-logo.png`. Tagline: "FQHC Compliance Software".

> **Operating scope: Florida only.** Every customer health center and site is in
> Florida. Florida sources, time zones, and state rules are in
> `docs/compliance/florida.md`. Decision owner for roadmap decisions, counsel
> engagement, and HRSA project officer contact: the product owner (@jselvalugo).

> Status: pre-build. This repository currently holds the agent definitions and
> the specs they work from. No application code exists yet.

> **Market requirements.** Build toward `docs/compliance/market-requirements.md`
> (MR-1 to MR-7). If any of them cannot be met under the current scope,
> principles, or ADRs, stop that part of the work and notify the product owner
> as its §4 describes. Never work around it silently.
> Decided 2026-09-27 (MR-D0): Deemed Health stays compliance software. No ONC
> certification, no UDS computed from patient-level data, and no Medicaid PPS
> billing. Build the compliance side of each requirement only.

## Product principles

1. **Readiness is continuous.** Every HRSA requirement maps to evidence, an
   owner, a cadence, and a status that is recomputed as data changes.
2. **AI guides, humans decide.** AI drafts, summarizes, flags and explains. It
   never attests, approves, signs, submits to HRSA, or closes a finding.
3. **Cite the source.** Every requirement, finding, and AI answer points to the
   regulatory source it depends on (Compliance Manual chapter/element, CFR
   section, PAL/PIN number) and the date that source was last verified.
4. **Requirements are data, not code.** Regulatory rules live in a versioned
   requirements catalog with effective dates, so an HRSA policy update is a
   catalog change plus migration, not a rewrite.
5. **Everything is auditable.** Every create/update/approve/export is written to
   an append-only audit log with actor, timestamp, before/after.
6. **PHI is minimized.** The suite manages staff, board, contract, and
   organizational data. Patient-level data is out of scope unless a module
   explicitly needs it (e.g., grievances) and then it is minimized and encrypted.
7. **Plain language, bilingual.** English and Spanish UI from day one.

## Where things are

| Path | What it is |
| --- | --- |
| `.claude/agents/` | Subagent definitions (one file per role — see roster below) |
| `docs/brand/design-system.md` | Colors, type, tokens, and the app shell (header, module bar, launcher) |
| `docs/product/module-map.md` | The module and page registry — the single source for navigation |
| `docs/product/implementation-roadmap.md` | Build phases and the security/compliance gates each one must pass before real data is allowed |
| `docs/compliance/hrsa-requirements-framework.md` | HRSA requirements mapped to modules, evidence, and cadences |
| `docs/compliance/florida.md` | Florida operating profile: state sources, privacy and breach rules, time zones |
| `docs/compliance/market-requirements.md` | What Florida FQHCs expect (ONC, HIPAA, OSV, UDS, Medicaid PPS, Florida rules), what is on plan, and what is blocked |
| `docs/adr/` | Architecture Decision Records (`NNNN-title.md`) |
| `assets/brand/` | Logo and brand assets |

## Agent roster and routing

Use the agent whose scope matches the work. Cross-cutting work starts with
`suite-architect`, which splits it and hands pieces to the others.

| Agent | Owns |
| --- | --- |
| `suite-architect` | Architecture, module registry, ADRs, sequencing, cross-module contracts, definition of done |
| `hrsa-regulatory-analyst` | Requirements catalog, citations, regulatory review of every feature, policy-update impact |
| `design-system-engineer` | Brand tokens, app shell, module launcher / command palette, shared components |
| `frontend-engineer` | Module pages built on the shell and components |
| `backend-engineer` | APIs, domain services, workflow + rules engine, jobs, notifications |
| `data-architect` | Multi-tenant schema, evidence/document versioning, audit log, migrations, reporting views |
| `credentialing-privileging-specialist` | Providers, credentialing, privileging, expirations, primary source verification |
| `enrollment-screening-specialist` | Payer enrollment, revalidation, OIG/SAM/state exclusion screening |
| `governance-board-specialist` | Board composition/authority, meetings, minutes, approvals, conflict of interest, policies |
| `ftca-risk-quality-specialist` | FTCA deeming, risk management, QI/QA, UDS, patient experience, grievances |
| `finance-grants-specialist` | Sliding fee, billing & collections, budget, financial management, contracts & subawards, scope of project |
| `integrations-engineer` | External data sources (LEIE, SAM.gov, NPPES, license boards, CAQH, EHBs exports) |
| `ai-assistant-engineer` | Deemed Assistant: guided actions, briefs, document intake, guardrails |
| `security-privacy-officer` | HIPAA safeguards, RBAC, encryption, audit, retention, BAAs, threat review |
| `qa-test-engineer` | Test strategy, regulatory fixtures, date/cadence math, accessibility, E2E |
| `ux-content-writer` | UI copy, EN/ES strings, in-app wiki, empty states, error messages |
| `platform-devops-engineer` | Toolchain, CI/CD, environments and PREVIEW guarantee, hosting, backups/DR, observability, job operations, releases |

The shared modules (Command Center, Tasks & Workflows, Self-Service, Learning,
Administration) are built by `frontend-engineer` and `backend-engineer` under
`suite-architect`. The domain specialists supply the content for them.

Every agent that builds a compliance feature must get a sign-off pass from
`hrsa-regulatory-analyst`; every feature that touches personal data must get a
pass from `security-privacy-officer`.

### Feature handoff order

1. `suite-architect` plans: scope, affected modules and entities, task table.
2. `hrsa-regulatory-analyst` adds or confirms the catalog `requirementId`s and citations.
3. The domain specialist writes the rules, evidence list, and workflow for its module.
4. `data-architect` designs the schema and migration; `backend-engineer` builds the
   services, jobs, and API; `integrations-engineer` adds any external source.
5. `ux-content-writer` supplies EN/ES copy; `frontend-engineer` builds the pages on
   the shell and components from `design-system-engineer`.
6. `ai-assistant-engineer` adds assistant actions or briefs, if any.
7. `qa-test-engineer` covers tests; `platform-devops-engineer` covers jobs, alerts, and rollout.
8. Sign-offs: `hrsa-regulatory-analyst` (always) and `security-privacy-officer`
   (personal data), recorded in the PR.

## Proposed default stack (confirm in ADR-0001)

- TypeScript monorepo (pnpm workspaces): `apps/web`, `apps/api`, `packages/ui`,
  `packages/domain`, `packages/requirements-catalog`.
- Web: Next.js (App Router), React, Tailwind CSS driven by the tokens in
  `docs/brand/design-system.md`, Lucide icons.
- API/data: PostgreSQL with row-level security per tenant, Prisma or Drizzle,
  a job queue for screenings/expirations/notifications, S3-compatible object
  storage for evidence files (encrypted, versioned).
- Auth: SSO (OIDC/SAML) + MFA; role-based access with site scoping.
- AI: Claude API (latest Claude model) behind a server-side gateway.

Any agent may propose a change to this stack, but only through an ADR.

## Conventions

- Module and page names, routes, and icons come from `docs/product/module-map.md`.
  Do not invent navigation elsewhere.
- Colors come from design tokens only. No hex values in components.
- Every regulatory rule references a `requirementId` from the catalog.
- Dates: store UTC, display in the health center's time zone; due-date math is
  unit-tested including leap years and month ends.
- Non-production environments show the amber **PREVIEW** banner and use
  synthetic data only.
- Commits: imperative mood, one logical change per commit.

## Definition of done (every feature)

1. Maps to catalog `requirementId`s (or is explicitly non-regulatory).
2. Regulatory review by `hrsa-regulatory-analyst` recorded in the PR.
3. Tenant isolation, RBAC, and audit logging covered by tests.
4. EN and ES strings present; WCAG 2.1 AA checks pass.
5. Empty, loading, error, and "no permission" states designed.
6. Appears in the module map and the command palette.
