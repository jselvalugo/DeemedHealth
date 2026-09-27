# Module Map

Owner: `suite-architect`. This is the single source for modules, pages, routes, and
icons. The launcher, the module bar, breadcrumbs, and permissions are all generated from
the registry that implements this document (`packages/ui/module-registry.ts`).

`CM` = HRSA Health Center Program Compliance Manual chapter. See
`docs/compliance/hrsa-requirements-framework.md` for the details.

Status: `MVP` = first release, `Next` = second release, `Planned` = shown in
"How it works" with a `Planned` badge, not in the launcher.

| # | Module | Icon | Description (launcher) | Pages (route) | CM coverage | Status |
|---|---|---|---|---|---|---|
| 1 | **Command Center** | `layout-dashboard` | Daily readiness across every requirement, today's priorities, and what changed. | Overview `/` · Today's priorities `/priorities` · Readiness briefs `/briefs` · Calendar `/calendar` | All | MVP |
| 2 | **HRSA Readiness** | `shield-check` | Requirement-by-requirement status, evidence, findings, and site visit preparation. | Requirements `/readiness` · Evidence library `/readiness/evidence` · Findings & conditions `/readiness/findings` · Site visit prep `/readiness/osv` · Policy updates `/readiness/policy-updates` | Ch. 3–21 | MVP |
| 3 | **Providers & Credentialing** | `badge-check` | Provider files, primary source verification, privileges, and expirations. | Providers `/providers` · Credentialing `/providers/credentialing` · Privileging `/providers/privileging` · Expirations `/providers/expirations` · Committee review `/providers/committee` | Ch. 5, 21 | MVP |
| 4 | **Enrollment** | `id-card` | Payer enrollment, reassignments, revalidation, and effective dates by provider and site. | Enrollment board `/enrollment` · Payers `/enrollment/payers` · Revalidations `/enrollment/revalidations` · Applications `/enrollment/applications` | Ch. 16 (billing readiness) | MVP |
| 5 | **Screening** | `scan-search` | OIG, SAM, and state exclusion screening for staff, board, and vendors. | Screening runs `/screening` · Possible matches `/screening/matches` · Screening history `/screening/history` | Ch. 5, 12, 13; 2 CFR 180 | MVP |
| 6 | **Governance** | `landmark` | Board roster and composition, meetings, minutes, approvals, and conflict of interest. | Board roster `/governance/board` · Meetings & minutes `/governance/meetings` · Approvals log `/governance/approvals` · Conflict of interest `/governance/coi` · Policies `/governance/policies` | Ch. 11, 13, 19, 20 | MVP |
| 7 | **Scope & Sites** | `map-pin` | Form 5A services, Form 5B sites, Form 5C activities, hours, and change in scope requests. | Services (5A) `/scope/services` · Sites (5B) `/scope/sites` · Other activities (5C) `/scope/activities` · Change in scope `/scope/changes` · Hours & coverage `/scope/hours` | Ch. 4, 6, 7, 8 | Next |
| 8 | **Contracts & Agreements** | `file-signature` | Contracts, subawards, referral and collaborative agreements with required provisions. | Contracts `/contracts` · Subawards `/contracts/subawards` · Collaborative relationships `/contracts/collaborations` · Renewals `/contracts/renewals` | Ch. 12, 14 | Next |
| 9 | **Finance & Grants** | `wallet` | Sliding fee program, billing and collections policies, budget, and financial controls. | Sliding fee program `/finance/sfdp` · Billing & collections `/finance/billing` · Budget `/finance/budget` · Grant reporting `/finance/grants` · Audit `/finance/audit` | Ch. 9, 15, 16, 17 | Next |
| 10 | **FTCA & Risk** | `umbrella` | FTCA deeming readiness, risk assessments, training, claims, and tracking systems. | Deeming application `/ftca` · Risk assessments `/ftca/risk` · Incidents `/ftca/incidents` · Claims `/ftca/claims` · Tracking systems `/ftca/tracking` | Ch. 21 | MVP |
| 11 | **Quality & UDS** | `activity` | QI/QA program, clinical measures, peer review, and UDS reporting readiness. | QI/QA plan `/quality` · Measures `/quality/measures` · Peer review `/quality/peer-review` · UDS `/quality/uds` · Needs assessment `/quality/needs-assessment` | Ch. 3, 10, 18 | Next |
| 12 | **Patient Experience** | `heart-handshake` | Patient surveys, grievances, and feedback trends reported to the board. | Surveys `/experience/surveys` · Grievances `/experience/grievances` · Trends `/experience/trends` | Ch. 10, 19 | Next |
| 13 | **Learning** | `graduation-cap` | Required trainings, assignments, and completion evidence by role. | Catalog `/learning` · Assignments `/learning/assignments` · Completions `/learning/completions` | Ch. 5, 21 | Next |
| 14 | **Tasks & Workflows** | `list-checks` | Every action item across modules, with owners, due dates, and approvals. | My tasks `/tasks` · Team queue `/tasks/team` · Workflows `/tasks/workflows` · Approvals `/tasks/approvals` | All | MVP |
| 15 | **Self-Service** | `user-round-check` | Staff and board members update their own documents, attestations, and trainings. | My profile `/me` · My documents `/me/documents` · My attestations `/me/attestations` | Ch. 5, 13 | Next |
| 16 | **Administration** | `settings` | Users, roles, sites, integrations, audit log, and health center settings. | Users & roles `/admin/users` · Organization & sites `/admin/org` · Integrations `/admin/integrations` · Requirements catalog `/admin/catalog` · Audit log `/admin/audit` · Support access `/admin/support-access` | — | MVP |

**Support access** (`/admin/support-access`, permission `admin.support_access.approve`,
default Compliance officer) is where a customer administrator approves or denies Loogo Labs
support-access requests, revokes active grants, and views grant history with links to the
matching audit events (ADR-0012 §6).

## Operator console (internal)

Loogo Labs operators only. A separate app (`apps/console`) on its own subdomain, with workforce
SSO and passkeys (ADR-0012). **Not in the customer launcher, module bar, or command palette**;
it has its own navigation from a separate `consoleModules` registry export. Operators see
metadata and aggregate counts only; tenant data is reachable only through a customer-approved
support grant or break-glass.

| # | Area | Icon | Description | Pages (route) | Roles |
| --- | --- | --- | --- | --- | --- |
| C1 | **Tenants** | `building-2` | Provision, suspend, and offboard health centers (Florida only). | Tenants `/tenants` · New tenant `/tenants/new` · Tenant detail `/tenants/:organizationId` · Offboarding `/tenants/offboarding` | platform-admin (write); all (read) |
| C2 | **Support access** | `life-buoy` | Request and use customer-approved, time-boxed support grants; break-glass. | Requests `/support-access` · Active sessions `/support-access/sessions` · Break-glass `/break-glass` | support, platform-admin |
| C3 | **Catalog releases** | `book-check` | Publish verified catalog releases and see their aggregate impact. | Releases `/catalog/releases` · Release detail `/catalog/releases/:version` | catalog-publisher (publish); all (read) |
| C4 | **Feature flags** | `toggle-right` | Flag values per environment and per tenant; AI off by default. | Flags `/flags` · Tenant flags `/flags/tenants` | platform-admin (write); all (read) |
| C5 | **Platform health** | `gauge` | Integration runs, job queues, and audit chain verification. | Integrations `/health/integrations` · Job queues `/health/jobs` · Audit chain `/health/audit-chain` | all (read); platform-admin (job retry/discard) |
| C6 | **Operators** | `shield-user` | Operator accounts, roles, and the platform audit log. | Operators & roles `/operators` · Platform audit log `/audit` | platform-admin |

Operator roles: `platform-admin`, `support`, `catalog-publisher`, `read-only-ops` (capability
matrix in ADR-0012 §3).

## Auth routes (outside the shell)

These pages are not navigation: they never appear in the launcher or the module
bar, and they render without the header and module bar (the PREVIEW banner still
shows). They are registry data (`AUTH_ROUTES` in `packages/ui/module-registry.ts`)
so routes stay in one place. Added in Phase 1 slice S1.

| Page | Route | Purpose |
|---|---|---|
| Sign in | `/sign-in` | Work email, then single sign-on or password (ADR-0006 rules 1–2) |
| Verify it's you | `/sign-in/mfa` | Second step: passkey or authenticator code; no SMS or email codes (ADR-0006 rule 3) |
| Can't sign in? | `/sign-in/recovery` | Recovery code, or how to ask an administrator for a reset (ADR-0006 rule 11) |
| No permission | `/no-permission` | Inside the shell: shown when a role includes no page to land on |

States on `/sign-in`: `?reason=expired` (idle timeout) and `?reason=signed-out`.

The **Deemed Assistant** is not a module. It is a right-side panel that can be
opened from any page, plus a "Deemed briefs" card on the Command Center. See
`.claude/agents/ai-assistant-engineer.md`.

## Default roles

| Role | Sees |
| --- | --- |
| Executive (CEO/COO/CFO/CMO) | All modules, read. Approvals in their area |
| Compliance officer | All modules, full |
| Credentialing coordinator | Providers, Enrollment, Screening, Learning, Tasks |
| Board liaison | Governance, Readiness (read), Tasks |
| Board member | Self-Service, Governance (their packets, read-only) |
| QI / Risk manager | FTCA & Risk, Quality, Patient Experience, Tasks |
| Finance | Finance & Grants, Contracts, Scope (read), Tasks |
| Staff / provider | Self-Service, Learning, My tasks |
| Auditor (time-boxed) | Read-only, the evidence library, and exports. Every view is logged |
| Health center administrator | Administration: users & roles, organization & sites, integrations, support access. No compliance module data (decision D15) |

All roles can be limited to specific sites.

## Registry entry shape

```ts
type ModuleEntry = {
  id: string;               // 'providers'
  name: I18nKey;            // 'module.providers.name'
  description: I18nKey;
  icon: LucideIconName;
  status: 'mvp' | 'next' | 'planned';
  requirementChapters: number[];
  pages: { id: string; name: I18nKey; route: string; icon: LucideIconName; permission: Permission }[];
};
```
