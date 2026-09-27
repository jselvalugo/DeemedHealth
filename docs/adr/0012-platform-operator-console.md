# ADR-0012: Platform operator console and customer-approved support access

- Status: **Accepted** (@jselvalugo, 2026-09-27; roadmap D10)
- Date: 2026-09-27
- Owner: `suite-architect`
- Reviewers required: `security-privacy-officer` (HIPAA guardrails, RBAC, audit),
  `data-architect` (roles, `SECURITY DEFINER` functions, audit chains),
  `platform-devops-engineer` (hosting, network restrictions), `hrsa-regulatory-analyst`
  (catalog publishing), product owner (@jselvalugo, roadmap decision D10)
- Amends, on acceptance: ADR-0001 (layout: `apps/console`), ADR-0002 rule 3 (scope of
  `app_platform`, new `support_reader` role), ADR-0008 §1 (`actor_type` gains `support`)
  and §6 (operator access to a tenant's log may use a support grant, not only
  break-glass)
- Consistent with: ADR-0006 rules 8 and 9 (no standing workforce access; customer-granted,
  time-boxed, audited support; sealed break-glass), ADR-0007 rule 10 (crypto-shredding),
  ADR-0003 (verified-only production catalog), security policies §1 and §7
- Naming: tenant column `organization_id`, setting `app.organization_id`, runtime roles
  `app_user` and `app_platform`, as reconciled in ADR-0011

## Context

The product owner asked that the application have an admin console. There are two
different audiences:

1. **Customer administrators** manage their own health center: users, roles, sites,
   integrations, catalog view, and audit log. That is the Administration module (module
   16 in `docs/product/module-map.md`), inside the customer app and inside the tenant's
   RLS boundary. It already exists in the plan (Phase 1 slice S7).
2. **Loogo Labs operators** run the platform: they create and retire tenants, publish
   catalog releases, turn features on per tenant, and watch integrations, jobs, and the
   audit chain. Today there is no place for this work, so it would drift into database
   consoles, scripts, or ad-hoc admin routes in the customer app. Each of those is a path
   to standing workforce access to PHI and PII, which ADR-0006 rule 8 and security
   policy §1 forbid.

HIPAA forces: workforce access must be limited to the minimum necessary (45 CFR
164.502(b), 164.514(d)); access must be authorized, unique per person, and logged
(164.308(a)(4), 164.312(a), (b), (d)); the customer, as covered entity, decides who may
see its data under the BAA. Citations are planning assumptions (roadmap preface).

## Decision

### 1. A separate app on its own origin

- **`apps/console`** is a Next.js app, separate from `apps/web`, served on its own
  subdomain (production `console.<product domain>`; development its own Netlify site).
  It never shares an origin, cookie, session store, or bundle with the customer app, and
  it does not appear in the customer launcher or command palette.
- Same service boundary as ADR-0001: `apps/console` never touches the database. It calls
  a **platform API plugin** in `apps/api` (`/platform/*`) that is mounted only on the
  console hostname. In production it runs as a separate ECS service (`api-platform`)
  from the same image, behind its own load balancer and WAF. It is the only
  request-serving process that holds `app_platform` credentials; the customer `api`
  service never does. On Netlify (development) it is a separate function on the console
  site.
- Security headers as the customer app, plus `frame-ancestors 'none'`, a strict CSP,
  and no third-party scripts.

### 2. Operator identity

- **Workforce SSO:** OIDC against the Loogo Labs workforce IdP only. Customer IdPs and
  local accounts cannot sign in to the console.
- **Phishing-resistant MFA only:** passkeys / WebAuthn with user verification required,
  enrolled per operator. `platform-admin` and anyone who can approve break-glass must
  use a hardware security key. No TOTP, SMS, or email codes. The console steps up with
  its own passkey even when the IdP asserts MFA.
- **Network and device:** in production, the console hostname accepts requests only from
  the Loogo Labs allowlisted egress (VPN or zero-trust gateway) through a WAF IP set.
  Where the workforce IdP supports it, a managed-device condition is required
  (conditional access or device-bound passkeys). Development may relax the IP rule; it
  holds synthetic data only.
- **Short sessions:** 10-minute idle, 4-hour absolute, re-authentication within 5
  minutes for every write (provision, suspend, offboard, publish, flag change, grant
  request, break-glass), session bound to one operator and one device, revoked on IdP
  deprovisioning within 60 seconds (ADR-0006 rule 6 applied to operators).
- Operator accounts live in platform tables (`platform.operator`,
  `platform.operator_role_assignment`, `platform.operator_session`), not in any tenant.

### 3. Operator RBAC

Roles are held in Deemed Health, granted by a `platform-admin` with the security
officer's approval, reviewed quarterly (policies §1), deny by default. IdP groups are
not trusted for roles (ADR-0006 rule 7).

| Capability | `platform-admin` | `support` | `catalog-publisher` | `read-only-ops` |
| --- | --- | --- | --- | --- |
| View tenant list and metadata, health dashboards, audit-chain status | Yes | Yes | Yes | Yes |
| Provision, suspend, reactivate a tenant | Yes | No | No | No |
| Start offboarding; approve crypto-shred (second approver) | Yes (two-person) | No | No | No |
| Publish a catalog release | No | No | Yes | No |
| Change feature flags per tenant | Yes | No | No | No |
| Retry or discard failed jobs | Yes | No | No | No |
| Request a support-access grant; open an approved support session | Yes | Yes | No | No |
| Request break-glass (second approval by the security officer) | Yes | No | No | No |
| Manage operators and roles | Yes (with security officer approval) | No | No | No |

A person may hold more than one role, but no one approves their own request (grant,
break-glass, crypto-shred, operator role).

### 4. Capabilities

1. **Tenant lifecycle**, a state machine: `provisioning → active ⇄ suspended →
   offboarding → export_delivered → pending_shred → shredded`.
   - *Provision:* legal name, award type (§330 or Look-Alike; blocked until that award
     type's catalog entries are verified, FL-D2), public-agency flag (FL-D3), sites with
     Florida addresses and `America/New_York` or `America/Chicago` time zones (ADR-0002
     rule 9), the first customer administrator's work email (write-only; shown masked
     afterwards), IdP choice. Provisioning creates the per-tenant KMS key (ADR-0007
     rule 3), the tenant audit genesis row (ADR-0008 §2), and default feature flags
     (ADR-0013 §4).
   - *Suspend:* blocks sign-in, API access, and tenant jobs, keeps all data, requires a
     reason, notifies the customer's administrators; reversible.
   - *Offboard:* requires a contract reference. The full export (records, evidence, and
     the verifiable audit export with manifest, ADR-0008 §6) is generated by a job and
     delivered **to the customer's administrator**, never to the operator; the operator
     sees status and manifest hash only. After the retention period and a legal-hold
     check, crypto-shred schedules deletion of the tenant's keys (ADR-0007 rule 10) with a
     deletion window longer than backup retention, within the 90 days of policy §7. The
     shred needs two `platform-admin` approvals (or one plus the security officer).
2. **Catalog release publishing:** lists compiled bundles from CI, shows the diff,
   requirement counts, and verification status, and publishes through the ADR-0003
   publish job. Production rejects any entry that is not `verified` (database
   constraint); the console cannot override it. Impact preview is aggregate (instances
   affected per tenant as counts).
3. **Feature flags per tenant** (model in ADR-0013 §4). Every AI capability
   (ADR-0004) is **off by default** for every tenant and every environment, and turning
   it on for a production tenant requires a recorded prerequisite (customer AI addendum
   and the ADR-0004 capability gate). Flags never grant permissions.
4. **Integration health:** per source (LEIE, SAM.gov, AHCA, NPPES, FL DOH MQA, CAQH)
   run counts, failure rate, lag, and last success, per tenant as counts only. No
   names, matches, or payloads.
5. **Job queue health:** depth, oldest age, failures, and dead letters by queue and
   job type. Payloads are not shown (jobs carry ids only). Retry or discard needs a
   reason and is audited.
6. **Audit chain verification status:** per tenant and for the platform chain: last
   verification run, result, head `chain_seq`, last external anchor (ADR-0008 §2, §9).
   A failure alerts on-call. Event contents are not shown.
7. **Support access requests:** request, track, and use grants (§6).
8. **Platform audit log:** the platform chain (ADR-0008 platform tenant), filterable and
   exportable by `platform-admin` with re-authentication.

### 5. HIPAA guardrail: metadata and aggregates only by default

- Operators see **tenant metadata and aggregate counts**, never tenant PHI or PII, by
  default. Allowed by default: organization id, legal name, award type, lifecycle
  state, site count and site city and county, user counts by role, catalog version,
  flag values, health metrics, chain status. Not allowed: any person's name, email,
  DOB, license, NPI, screening result, document, evidence file, audit event content,
  or free text written by the customer.
- Enforcement is in the database, not the UI. `app_platform` has **no** `SELECT` on
  tenant tables. It reads only through `SECURITY DEFINER` functions in the `platform`
  schema that return fixed column sets. A CI check enumerates every function executable
  by `app_platform` and fails if any return column has a data-dictionary sensitivity
  class of PII or PHI, unless the function is one of the support-grant functions in §6.
- **No role has `BYPASSRLS`** (ADR-0002 rule 3 unchanged). Every function sets
  `app.organization_id` with `set_config(..., true)` and reads under forced RLS.
- Function owners are reviewed by `security-privacy-officer` (ADR-0002 rule 3).

### 6. Support-access grants (the only routine path to tenant data)

1. **Request.** An operator with `support` or `platform-admin` requests a grant for one
   tenant with: reason and support ticket reference, scope (a list of modules or
   entities from the registry), mode (`read` by default; `support-actions` optional),
   and duration (default 1 hour, **maximum 4 hours**). Pending requests expire after
   24 hours.
2. **Approval by the customer.** A customer user with the permission
   `admin.support_access.approve` (default: Compliance officer) approves or denies it
   in **Administration › Support access** (`/admin/support-access`) after step-up
   re-authentication. They may shorten the duration or narrow the scope, never widen
   it. The approval is an explicit `Approval` record: approver, role, timestamp,
   reason, and the version of the grant request approved. Only humans approve.
3. **Use.** The operator opens a support session in the console, which shows a
   persistent banner (tenant, mode, scope, expiry). Reads go through
   `platform.support_read_*` `SECURITY DEFINER` functions owned by a new role
   `support_reader` (`NOBYPASSRLS`, `SELECT` on scoped tables only). Each call checks,
   in the database, that an active grant exists for this operator, tenant, and object
   type, that it is not expired or revoked, and then sets `app.organization_id` and
   reads under RLS.
   - Field-encrypted values stay masked. Reveals, exports, and evidence downloads are
     **not** possible under a support grant.
   - `support-actions` mode allows only a fixed allowlist of named operations (resend
     an invitation, re-run a readiness recompute, retry a tenant job). There is no
     generic edit. Operators never approve, attest, sign, or close findings on a
     customer's behalf (principle 2).
4. **Audit in both chains.** Every read and action writes two events through
   `audit.append_event` in the same transaction: one in the **platform** chain and one
   in the **tenant's** chain. The tenant event has `actor_type = 'support'` (new value),
   the operator as actor, `on_behalf_of_id` = the approving customer administrator,
   `reason` = the grant reason, and `metadata.support_grant_id`. Both events share
   `request_id`. Support reads are audited individually (target table and ids, row
   count), unlike ordinary reads.
5. **Revocation and expiry.** The customer can revoke at any time; the next function
   call fails and the console session ends within 60 seconds. Expiry is enforced by the
   database clock (`clock_timestamp()`), not the app.
6. **Notifications.** Customer administrators are notified on request, approval, first
   use, revocation, and end, with a summary of what was viewed (entities and counts).
7. **Tenant opt-out.** A tenant may turn off support requests entirely in the same page.

### 7. Break-glass (the only exception)

- Used only when a customer cannot approve in time and there is a security incident, an
  outage affecting their data, or a legal obligation (ADR-0006 rule 9).
- **Two-person approval:** a `platform-admin` requests with a reason; the security
  officer (or the product owner) approves with a hardware key. Neither may approve
  their own request. Maximum 1 hour, not renewable without a new request.
- **Immediate customer notification:** on activation, all the tenant's administrators
  are notified in-app and by email, and on-call is paged. Review within one business
  day (ADR-0006 rule 9), recorded in the incident record.
- Runs through the same `support_reader` functions with `actor_type = 'break_glass'` in
  both chains. It is not a database superuser path; the sealed superuser accounts of
  ADR-0006 stay outside the console.

### 8. Data model additions

Platform (no `organization_id`): `operator`, `operator_role_assignment`,
`operator_session`, `tenant_lifecycle_event`, `catalog_release_publication`,
`feature_flag` (ADR-0013). Tenant tables with RLS (the customer must see and approve
them): `support_access_grant`, `support_access_event_summary`, `tenant_feature_flag`
(read-only to `app_user`). New audit actions registered in `audit-actions.ts`:
`tenant.provision`, `tenant.suspend`, `tenant.reactivate`, `tenant.offboard_start`,
`tenant.export_delivered`, `tenant.crypto_shred`, `support_access.request`,
`support_access.approve`, `support_access.deny`, `support_access.revoke`,
`support_access.read`, `support_access.action`, `breakglass.request`,
`breakglass.approve`, `feature_flag.set`, `catalog_release.publish`, `job.retry`,
`job.discard`, `operator.role_grant`.

## Alternatives considered

- **Operator pages inside `apps/web` behind a role.** One app fewer, but it shares the
  customer origin, cookies, and bundle; a routing or RBAC bug would expose operator
  powers to customers or tenant data to operators. Rejected.
- **Database consoles and scripts for operations.** No UI to build, but no minimum
  necessary control, weak audit, and standing access. Rejected (policy §1).
- **An internal admin framework (Retool, Forest Admin).** A new subprocessor with direct
  database access and its own identity. Rejected.
- **`BYPASSRLS` operator role with app-layer checks.** Simpler queries, but one missed
  check reads every tenant. Rejected (ADR-0002).
- **Impersonation ("log in as customer user").** Blurs the actor in the audit log and
  grants the user's full permissions, including approvals. Rejected; support sessions
  are read-only, scoped, and attributed to the operator.
- **Loogo Labs approves support access internally.** The customer is the covered entity
  and decides who sees its data. Rejected except for break-glass.

## Consequences

- A second web app, a second API service, and a console hostname to secure and deploy.
- Customers own the decision to let support in; support may be slower. Break-glass
  covers emergencies at the cost of two approvals and an immediate notice.
- Every `app_platform` function is security-reviewed and CI-checked for its return
  columns; adding one is a deliberate change.
- The tenant audit log shows support activity explicitly, which customers can export and
  verify.
- Tests (owned by `qa-test-engineer`): a support grant cannot read another tenant, an
  out-of-scope entity, after expiry, or after revocation; `app_platform` cannot select a
  tenant table; every support read writes two events; a reveal or export under a grant
  fails; operators cannot sign in without a passkey; the customer launcher registry
  contains no console route.
- **Follow-ups:** `packages/ui/module-registry.ts` gains the Administration page and a
  separate `consoleModules` export (with the module map, one PR); ADR-0008 action
  registry and `actor_type` enum; ADR-0002 role list note; threat model entries for the
  console and support sessions; `docs/security/policies.md` §1 wording that points to
  this flow; the customer BAA and terms describe support access (counsel, roadmap D3).

## Status

Accepted by the product owner (@jselvalugo) on 2026-09-27 as roadmap decision D10.
Implementation PRs still need reviews by `security-privacy-officer`, `data-architect`,
`platform-devops-engineer`, and `hrsa-regulatory-analyst`.
