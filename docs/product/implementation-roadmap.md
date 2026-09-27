# Implementation Roadmap

Owner: `suite-architect`. Co-owners of the gates: `security-privacy-officer`
(security and privacy) and `hrsa-regulatory-analyst` (regulatory accuracy).

This document splits the build of Deemed Health into phases. **Each phase ends
at a gate.** A gate is a checklist of controls that must be finished and backed
by evidence, such as a test run, a signed document, or a report. The next phase
does not start, and data of a more sensitive kind does not enter the system,
until the gate passes. The phases are ordered so that the controls exist
**before** the data they protect arrives.

It builds on the sequencing in `.claude/agents/suite-architect.md`, the module
statuses in `docs/product/module-map.md`, the baseline controls in
`.claude/agents/security-privacy-officer.md`, and the requirement map in
`docs/compliance/hrsa-requirements-framework.md`. Where this document and one of
those files disagree, fix both in the same change.

> Regulatory and legal statements here are planning assumptions. Before a gate
> relies on one, `hrsa-regulatory-analyst` (HRSA items) or
> `security-privacy-officer` (HIPAA and security items) verifies it against the
> current source, and the item is escalated to legal counsel where noted.

## 1. Overview

| Phase | Name | What gets built | Most sensitive data allowed | Ends at |
| --- | --- | --- | --- | --- |
| 0 | Foundations | Decisions, security program, CI guardrails, catalog schema | None (docs and code only) | G0 · Build-ready |
| 1 | Platform core | Shell, identity, tenancy, audit, evidence store, catalog, readiness engine, Tasks service, Administration | Synthetic only | G1 · Platform-secure |
| 2 | MVP modules | Providers & Credentialing, Screening, Enrollment, Governance, Tasks, Command Center, first integrations | Synthetic only | G2 · Feature-complete MVP |
| 3 | FTCA & Risk | FTCA & Risk module, restricted-data handling for incidents and claims | Synthetic only | G3 · Restricted-data-ready |
| 4 | Operational readiness | Production environment, external testing, legal and HIPAA paperwork, support and incident response | Synthetic only (production is built, but no customer yet) | G4 · **Ready to operate (internal)** |
| 5 | Controlled pilot | 1–2 design-partner health centers under a BAA | Customer staff/board PII; limited PHI in FTCA incidents only | G5 · General availability |
| 6 | Deemed Assistant | AI briefs, document intake, assistant panel, behind evals and a per-tenant switch | Same as the tenant's data, minimized per the gateway | Per-capability eval gate |
| 7 | Next modules | Scope & Sites, Contracts, Finance & Grants, Quality & UDS, Patient Experience, Learning, Self-Service | Adds grievance narratives (PHI) with Patient Experience | Per-module gate (§5, §10) |
| 8 | Scale and assurance | SOC 2 Type II, more state exclusion adapters, performance, multi-region DR | Unchanged | Annual review |

Phases 6 and 7 can overlap with Phase 5 once G5's pilot findings are closed.
Everything else is sequential.

Phase 1 must not be skipped or shortened to reach a demo sooner. The demo
environment is Phase 1's synthetic-data environment.

## 2. Standing rules for every phase

These hold from the first commit and are checked at every gate.

1. **Synthetic data until G4 passes, and outside production forever.** No real
   staff, board, provider, or patient data enters any environment before G4.
   Non-production environments always show the amber PREVIEW banner.
2. **Definition of done** from `CLAUDE.md` applies to every feature, including
   the regulatory sign-off by `hrsa-regulatory-analyst` and, for anything
   touching personal data, the review by `security-privacy-officer` using its
   checklist.
3. **CI blocks, it does not warn.** Type check, lint, unit and integration tests,
   dependency and secret scanning, SAST, and axe checks fail the build. Tests are
   never skipped or quarantined to get green.
4. **The software never acts for the health center with HRSA, CMS, or the FTCA
   program.** It never attests, approves, signs, submits, clears a screening
   match, grants privileges, or closes a finding. Humans do, and the approval is
   recorded.
5. **Readiness is internal.** No screen, export, or email may present a score or
   status as an HRSA determination or a certification.
6. **Every rule cites a catalog `requirementId`.** Only `status: verified`
   catalog entries are released to production tenants. `draft` entries exist
   only in non-production environments and in the analyst's review queue. They
   never appear in customer UI, exports, readiness, or AI answers.
7. **Out of scope until an ADR says otherwise:** Social Security numbers (see
   §13, decision D1), patient-level clinical data, EHR patient feeds, 42 CFR Part 2
   records, payment card data, and any submission to a government system.

## 3. Phase 0 · Foundations

**Goal:** make the decisions and put the guardrails in place so that code written
in Phase 1 is secure by default.

### Work

| Agent | Task | Done when |
| --- | --- | --- |
| `suite-architect` | ADR-0001 stack and repo layout; ADR-0002 tenancy and RLS; ADR-0003 catalog versioning; ADR-0004 AI gateway and guardrails | All four are `Accepted` |
| `suite-architect` + `platform-devops-engineer` | ADR-0005 hosting, environments, and regions: a HIPAA-eligible cloud under a BAA, US regions only, separate accounts for production and non-production | `Accepted` |
| `security-privacy-officer` | ADR-0006 identity: OIDC/SAML SSO, MFA for all roles, session and re-authentication rules, SCIM, break-glass admin | `Accepted` |
| `security-privacy-officer` + `data-architect` | ADR-0007 encryption and key management: KMS keys per environment, field-level encryption for DOB, DEA #, home address, incident and grievance narratives, key rotation | `Accepted` |
| `data-architect` | ADR-0008 audit log: append-only store, hash chain, monthly partitions, retention, customer export | `Accepted` |
| `security-privacy-officer` | Data classification scheme (public / internal / confidential / PII / PHI) and the data dictionary template | Published under `docs/security/` |
| `security-privacy-officer` | Initial HIPAA Security Rule **risk analysis** and risk management plan for the planned system (45 CFR 164.308(a)(1)(ii)(A)–(B)) | Signed by the security officer; reviewed at every later gate |
| `security-privacy-officer` | Threat model of the platform (STRIDE) covering tenancy, auth, uploads, integrations (SSRF), exports, and AI (prompt injection) | Published; each threat has an owner and a planned control |
| `security-privacy-officer` | Written security and privacy policies: access control, acceptable use, change management, incident response, breach notification, vendor management, retention, backup and DR | Adopted by Loogo Labs leadership |
| `security-privacy-officer` | Named HIPAA security officer (45 CFR 164.308(a)(2)) and privacy officer at Loogo Labs; workforce HIPAA and security training (164.308(a)(5)) and a sanctions policy | Named in writing; training completion recorded |
| `security-privacy-officer` | `docs/security/subprocessors.md`, listing each vendor, what data it may receive, and its BAA status | Hosting provider BAA signed; all others marked |
| `platform-devops-engineer` | Repo scaffolding: pnpm workspaces, CI with the blocking checks in §2 (rule 3), lockfiles, branch protection with required reviews, signed commits or builds, pinned images | CI runs on every PR; `main` cannot be pushed to directly |
| `hrsa-regulatory-analyst` | Register each authoritative source (framework §1) with its current version, URL, and verification date; define the catalog schema in `packages/requirements-catalog`. The schema carries applicability by award type (§330 vs. Look-Alike), sub-program, site type, and staff type, plus "Not applicable" with a required reason | Schema merged; sources registered |
| `qa-test-engineer` | Test strategy, synthetic fixture plan (`packages/test-fixtures`), and the quality gate thresholds wired into CI | Thresholds enforced in CI |

### Gate G0 · Build-ready

- [ ] ADR-0001 through ADR-0008 are `Accepted`.
- [ ] Risk analysis v1, threat model v1, and policies are signed.
- [ ] Hosting BAA is signed; the subprocessor list exists.
- [ ] CI blocks on every check in §2 (rule 3); lockfiles are enforced; builds are
      signed; container images are pinned by digest; branch protection is on.
- [ ] Catalog schema (with applicability) and source register are merged.

Sign-off: `suite-architect`, `security-privacy-officer`, `hrsa-regulatory-analyst`.

## 4. Phase 1 · Platform core

**Goal:** every control that modules depend on is built once, in the platform,
and proven by tests. Modules in later phases inherit it and cannot bypass it.

### Work

| Area | Agents | Scope |
| --- | --- | --- |
| App shell | `design-system-engineer`, `ux-content-writer` | Tokens, header, module bar, launcher / command palette generated from the module registry, PREVIEW banner, EN/ES i18n, empty / loading / error / no-permission states |
| Identity | `backend-engineer`, `integrations-engineer` | SSO (OIDC/SAML), MFA enforced, idle timeout, re-authentication for reveals, exports, approvals and admin changes, SCIM deprovisioning |
| Authorization | `backend-engineer`, `security-privacy-officer` | Policy-based RBAC with the default roles in the module map, site scoping, record-level rules, time-boxed auditor role, deny by default. The launcher hides what the API denies |
| Tenancy | `data-architect` | `organization_id NOT NULL` and an RLS policy on every tenant table, tenant set per transaction, plus a service-layer tenant check |
| Audit | `data-architect`, `backend-engineer` | Audit middleware on every mutation, sensitive reads, exports, auth events and permission changes; hash chain; Administration › Audit log page with export |
| Evidence store | `backend-engineer`, `data-architect` | Encrypted, versioned object storage; pre-signed URLs with short expiry; virus scanning; content-type validation; SHA-256; legal hold; no public buckets |
| Field encryption | `data-architect` | The field-encryption library from ADR-0007, with blind-index columns where search is needed, and reveal auditing |
| Catalog + readiness | `hrsa-regulatory-analyst`, `backend-engineer` | Catalog loader, `RequirementInstance`, deterministic readiness engine, snapshots that keep their catalog version, shared date/cadence module |
| Tasks & approvals service | `backend-engineer` | The domain service every module uses to create tasks and record approvals (the Tasks UI ships in Phase 2) |
| Notifications | `backend-engineer`, `integrations-engineer` | In-app plus email through a provider under a BAA. Messages carry no PII beyond the recipient's own name and no PHI |
| Administration | `frontend-engineer` | Users & roles, Organization & sites, Requirements catalog (read), Audit log |
| Environments | `platform-devops-engineer` | Local, per-PR preview, and staging built from infrastructure as code; `DH_ENV` turns on the PREVIEW banner and blocks real integrations outside production; secrets in the secret manager |
| Observability | `platform-devops-engineer`, `backend-engineer`, `security-privacy-officer` | Structured logs with correlation IDs and a PII/PHI scrubber; error tracker configured to drop request bodies; security alerting on auth anomalies |
| Data | `data-architect` | ERD, migrations, data dictionary with sensitivity classes, synthetic seed (XYZ Community Health Center, 3 sites) |

### Gate G1 · Platform-secure

- [ ] **Tenant isolation:** automated tests prove cross-tenant reads and writes
      fail at the database (RLS) and at the API, for every tenant-scoped table
      and endpoint.
- [ ] **Authorization:** each endpoint has allowed-role and denied-role tests,
      including a denied test for another site and another tenant.
- [ ] **Audit:** tests assert an audit event for every mutation, reveal, export,
      approval, login, and permission change; the hash chain verifies; the
      database role used by the app has no UPDATE or DELETE on `audit_event`.
- [ ] **Identity:** MFA cannot be turned off for any role; sessions expire;
      re-authentication is enforced on sensitive actions; SCIM deprovisioning
      revokes sessions.
- [ ] **Uploads:** an EICAR test file is rejected; a spoofed content type is
      rejected; pre-signed URLs expire.
- [ ] **Logging hygiene:** a test seeds known fake DOBs and DEA numbers and
      asserts they never appear in logs, traces, or error reports.
- [ ] **No SSN:** no form, API schema, or table has an SSN field; the importer
      rejects columns that look like SSNs; a CI check fails on SSN-shaped values
      in fixtures and seed data.
- [ ] **Readiness engine:** determinism tests; date math tests for leap years,
      month ends, and time zones; snapshots keep their catalog version.
- [ ] **Encryption:** the database, object storage, and backups are encrypted
      with KMS keys, and key rotation is on (configuration test).
- [ ] **Storage:** buckets block public access and are versioned; an object under
      legal hold cannot be deleted.
- [ ] **Roles:** the auditor role expires on its end date; record-level rules
      have denied-path tests.
- [ ] **Customer audit access:** a customer admin can view and export its own
      audit log, and a tampered row fails chain verification.
- [ ] **Environments:** non-production shows the PREVIEW banner.
- [ ] **Accessibility:** no axe violations on the shell and launcher; keyboard and
      screen-reader scripts pass.
- [ ] **Internal security review** by `security-privacy-officer` of the platform
      (verdict Approve), and the threat model updated with what was built.

Sign-off: `security-privacy-officer`, `qa-test-engineer`, `suite-architect`,
`hrsa-regulatory-analyst` (catalog and readiness engine).

## 5. Phase 2 · MVP modules

**Goal:** the MVP modules on top of the platform, in the order the architect set.
All data is still synthetic.

### Order and per-module focus

| # | Module | Owner(s) | Security and compliance focus |
| --- | --- | --- | --- |
| 1 | Providers & Credentialing | `credentialing-privileging-specialist`, `frontend-engineer` | DEA # and DOB are field-encrypted, masked by default, and revealed with audit. NPDB query responses are restricted documents (confidential under 45 CFR Part 60): readable only by credentialing roles and excluded from AI, search, and exports by default. Committee decisions are human approvals. Catalog entries for CM Ch. 5 and the credentialing part of Ch. 21 verified |
| 2 | Screening | `enrollment-screening-specialist`, `integrations-engineer` | LEIE and SAM adapters with provenance (file hash, retrieval time, raw response). A failed run never shows "clear". Possible matches are cleared only by a human, with a reason. Matching uses name, DOB, NPI, and license number, never SSN. When a possible match can only be resolved by SSN, the health center checks it on the source's own verification tool and records the outcome and method, not the SSN. Monthly cadence labeled as industry practice, not an HRSA rule. Florida sources: the AHCA sanctioned-provider list is the only state adapter (D4). Any cadence required by the Florida Medicaid agreement or SMMC plans is an `FL-*` catalog entry, not an HRSA requirement |
| 3 | Enrollment | `enrollment-screening-specialist` | Effective dates by payer and site; revalidation cadences from the catalog. NPPES lookups are public data; still logged with provenance |
| 4 | Governance | `governance-board-specialist` | Board approvals modeled as board approvals linked to a meeting and minutes (Ch. 19). Composition math (Ch. 20) from catalog parameters. Applicability covers the patient-majority waiver for health centers funded only under §330(g), (h), and/or (i), public-agency co-applicant arrangements, and the exemption for Indian tribes and tribal organizations. COI disclosures readable only by authorized roles |
| 5 | Tasks & Workflows (UI) | `frontend-engineer`, `backend-engineer` | Approvals pin the approved version; only humans approve |
| 6 | Command Center | `frontend-engineer` | Score always shown with its denominator and "internal readiness" wording; no HRSA-determination language |
| — | Scope record (minimal) | `finance-grants-specialist`, `data-architect` | The health center enters its HRSA-approved sites and services (Forms 5A/5B), dated as of its EHBs record, because scope drives applicability. The full Scope & Sites module ships in Phase 7 |
| — | HRSA Readiness | `frontend-engineer`, `hrsa-regulatory-analyst` | Evidence library, findings, site visit prep, and policy updates. Site-visit binder export is audited and watermarked "Internal readiness summary, not an HRSA determination" |

### Gate G2 · Feature-complete MVP

- [ ] Every MVP page meets the definition of done, including EN/ES and the four
      states.
- [ ] `hrsa-regulatory-analyst` review recorded per module (verdict Approve), and
      every catalog entry used by an MVP module is `verified` with its source and
      verification date.
- [ ] `security-privacy-officer` review recorded per module (verdict Approve).
- [ ] Integration contract tests run against recorded fixtures only; no live calls
      in CI; SAM.gov and LEIE terms of use reviewed and recorded.
- [ ] E2E journeys 1, 3, 4, 6, and 7 from `qa-test-engineer` pass in EN and ES.
- [ ] Coverage at or above the thresholds (90% `packages/domain`, 80% overall).
- [ ] Applicability tests cover §330 vs. Look-Alike. A tenant with award type
      Look-Alike cannot be provisioned until the Look-Alike entries are verified.
- [ ] An EN and ES copy audit finds no determination or certification wording
      (for example "HRSA approved", "compliant with HRSA", "aprobado por HRSA",
      "cumple con HRSA"), coordinated with `ux-content-writer`.
- [ ] Each integration run writes an audit event.
- [ ] The log-hygiene test passes with the new fields; the risk analysis has been
      reviewed.

Sign-off: `hrsa-regulatory-analyst`, `security-privacy-officer`, `qa-test-engineer`,
`suite-architect`.

## 6. Phase 3 · FTCA & Risk

**Goal:** the last MVP module. It is split out because incidents and claims can
contain PHI, so it adds the restricted-data controls the suite has not needed yet.

### Work

- `ftca-risk-quality-specialist`: deeming application readiness, quarterly risk
  assessments, risk training plan and completion, annual board report, incidents,
  claims, tracking systems.
- `data-architect` + `security-privacy-officer`: **restricted-data handling**.
  Incident and claim narratives are field-encrypted, never indexed in plain text,
  never sent in notifications, and visible only to the QI/Risk role and above.
  The incident form defaults to structured, de-identified fields; free text shows
  a "do not enter patient identifiers or substance use disorder treatment
  information" warning (Part 2).
- `hrsa-regulatory-analyst`: verify the FTCA entries against the current FTCA
  Health Center Policy Manual and the current deeming application instructions.
  The product prepares the health center's application; it never submits it.
  FTCA deeming applies only to §330 award recipients. Look-Alikes are not
  eligible, so the module is Not applicable for Look-Alike tenants.

### Gate G3 · Restricted-data-ready

- [ ] Restricted fields are encrypted, masked, reveal-audited, and excluded from
      search indexes, logs, notifications, exports by default, and analytics.
- [ ] Role tests prove only QI/Risk, Compliance officer, and authorized executives
      can read narratives.
- [ ] Retention and deletion behavior for incidents and claims is defined and
      implemented, with legal hold.
- [ ] Tests prove the software transmits no deeming or redeeming application,
      claim, or suit notice to anyone.
- [ ] The log-hygiene test passes with the restricted fields.
- [ ] Risk analysis updated for PHI; `hrsa-regulatory-analyst` and
      `security-privacy-officer` verdicts are Approve.

Sign-off: `hrsa-regulatory-analyst`, `security-privacy-officer`, `suite-architect`.

## 7. Phase 4 · Operational readiness

**Goal:** Loogo Labs is ready to hold real customer data. This is the gate that
allows operation. "Ready to operate" is an internal Loogo Labs decision. It is not
a federal authorization such as a FISMA or FedRAMP ATO. It covers the company, not only the code.

### Security and infrastructure

Built by `platform-devops-engineer`, defined and reviewed by
`security-privacy-officer`.


- Production environment built from infrastructure as code, in its own account,
  with least-privilege access for the workforce, MFA, just-in-time admin access,
  and every production access logged.
- WAF, rate limiting, DDoS protection, TLS 1.2+ only, HSTS, security headers, CSP.
- Encrypted backups; a **restore test** into an isolated account that meets the
  documented RPO/RTO.
- Vulnerability management: container and dependency scanning, patch SLAs by
  severity (for example critical in 7 days, high in 30), and an asset inventory.
- Security monitoring and alerting routed to an on-call rotation.
- **Independent penetration test** of the application and infrastructure, covering
  tenant isolation, auth, IDOR, uploads, SSRF, and exports. All critical and high
  findings fixed and retested.

### HIPAA and legal

- Risk analysis and risk management plan updated for the production system.
- **Customer BAA template** and **terms of service** reviewed by counsel. The terms
  state that readiness is internal, that the customer remains responsible for its
  HRSA compliance and submissions, and that AI output is a draft.
- BAAs signed with every subprocessor that may touch PHI (hosting, email, error
  tracking, the AI provider before Phase 6). `docs/security/subprocessors.md`
  complete and published to customers.
- Security incident procedures (45 CFR 164.308(a)(6)) and a breach notification
  procedure written for Loogo Labs' role as a **business associate**
  (45 CFR 164.410): notify the covered entity without unreasonable delay and no
  later than 60 days after discovery, or sooner if the BAA says so. It includes
  the four-factor risk assessment (164.402), security-incident reporting under
  the BAA (164.314(a)(2)(i)(C)), and notice from subcontractors to Loogo Labs.
  Proven by a **tabletop exercise**.
- Workforce training current; sanctions policy; access reviews scheduled
  (quarterly).
- Cyber liability insurance in place.
- Counsel review of Florida privacy and breach-notification law (FIPA, Fla. Stat.
  §501.171) and Florida's data-location rule (§408.051). See
  `docs/compliance/florida.md` §3.

### Operations

- Customer onboarding runbook: tenant creation, SSO setup, spreadsheet import
  with dry run, role assignment, and site scoping.
- Support process that never needs production data copied out; support access to a
  tenant is time-boxed, customer-approved, and audited.
- Status page and customer security contact.
- Offboarding runbook: tenant data export, then deletion with a certificate.

### Gate G4 · Ready to operate (internal)

- [ ] Penetration test: no open critical or high findings.
- [ ] Restore test passed within RPO/RTO.
- [ ] Incident response tabletop completed; lessons fixed.
- [ ] Every subprocessor that may touch PHI (hosting, email, error tracking) has
      a signed BAA, recorded in `docs/security/subprocessors.md`. The customer
      BAA template and terms are approved by counsel.
- [ ] TLS 1.2+, HSTS, CSP, and WAF verified by scan.
- [ ] Production access is just-in-time, MFA-protected, and logged; the first
      quarterly access review is done.
- [ ] Workforce training is current; the sanctions policy is adopted.
- [ ] Support access to a tenant is time-boxed, customer-approved, and audited
      (tested).
- [ ] The offboarding export-and-deletion runbook is rehearsed on synthetic data.
- [ ] The retention schedule is implemented for every data class. HIPAA
      documentation (policies, risk analyses, training records) is kept for
      6 years (45 CFR 164.316(b)(2)).
- [ ] A scan finds no production data in any non-production environment.
- [ ] Counsel's memo on Florida law (FIPA breach notice, §408.051 data location)
      is filed, and the breach procedure uses the strictest applicable deadline.
- [ ] `hrsa-regulatory-analyst` re-verified every production catalog entry
      against the current source within the 60 days before G4. Any PAL, PIN, or
      manual revision since G2 is processed as a changeset. The production
      catalog release contains no `draft` entries.
- [ ] Risk analysis updated and signed.
- [ ] Monitoring, on-call, and patch SLAs active.
- [ ] Written go/no-go decision signed by Loogo Labs leadership, the security
      officer, `hrsa-regulatory-analyst`, and `suite-architect`, filed with the
      evidence for each item.

Only after G4 may a production tenant receive real data.

## 8. Phase 5 · Controlled pilot

**Goal:** prove the MVP with 1–2 design-partner health centers under a signed
BAA, with tight limits.

- **Entry criterion:** the customer's BAA and terms are signed before its
  production tenant is provisioned or any import runs.
- The pilot runs **before** the SOC 2 Type I report (decision D2). Each pilot
  health center instead receives a security package under NDA: the risk analysis
  summary, the penetration test summary with fix status, the subprocessor list,
  and answers to its security questionnaire. The pilot agreement states that
  SOC 2 Type I is in progress.
- Pilot scope: MVP modules only; the Deemed Assistant is off. Both §330
  recipients and Look-Alikes may join (FL-D2), once their award type's catalog
  entries are verified.
- Data loaded through the audited importer with a dry run. PHI allowed only in
  FTCA incidents and claims, and only if the health center opts in.
- Weekly review with each pilot health center: accuracy of readiness statuses,
  missed or false alerts, and wording that could be read as an HRSA determination.
- Every reported readiness error is treated as a severity-1 defect: root cause,
  fix, and a regression fixture in `packages/test-fixtures`.
- Monthly access review and audit log review with the customer.

### Gate G5 · General availability

- [ ] No open severity-1 defects; every pilot readiness error has a regression test.
- [ ] Pilot customers confirm, in writing, that the statuses matched their own
      records for a full screening cycle at the cadence each health center adopted,
      and at least one expiration cycle.
- [ ] SOC 2 Type I report issued (decision D2). General availability waits for
      the report.
- [ ] Pricing, contract, and onboarding materials reviewed by counsel.
- [ ] The log-hygiene test passes; the risk analysis has been reviewed with the
      pilot findings.

Sign-off: Loogo Labs leadership, `security-privacy-officer`,
`hrsa-regulatory-analyst`, `suite-architect`.

## 9. Phase 6 · Deemed Assistant

The assistant ships **one capability at a time**, each behind a per-tenant
switch that the customer's administrator turns on.

| Order | Capability | Why this order |
| --- | --- | --- |
| 1 | Deemed briefs | Generated from structured readiness data; lowest risk |
| 2 | Suggested actions | Proposed tasks a human accepts |
| 3 | Document intake | Field extraction with confidence and human confirmation |
| 4 | Assistant panel | Open-ended questions; highest exposure to prompt injection and permission leakage |
| 5 | Policy update explainer | Depends on verified catalog changesets |

### Gate per capability

- [ ] AI provider BAA signed, and the provider's data retention settings match
      the retention policy. Recorded in the subprocessor list.
- [ ] Golden-set evals pass their thresholds in CI: accuracy, citation correctness,
      refusal on out-of-scope requests, permission leakage, cross-tenant leakage,
      and prompt injection.
- [ ] Tools run under the user's permissions; no tool can finalize, approve,
      attest, submit, or clear anything.
- [ ] Gateway masking of DOB and DEA #, and rejection of SSN-shaped values, proven by tests.
- [ ] Every output labeled "AI draft"; prompt version, model, tool calls, and the
      confirming user are audited.
- [ ] Before capability 4 (assistant panel) ships, the threat model is updated
      and a targeted penetration test of the panel is done.
- [ ] `hrsa-regulatory-analyst` review of grounding and citations;
      `security-privacy-officer` review of the PHI flow.

## 10. Phase 7 · Next modules

The `Next` modules from the module map ship one at a time. Each uses the Phase 2
per-module gate (definition of done, regulatory verdict, security verdict, E2E).
The table flags extra controls.

| Module | Extra control before it ships |
| --- | --- |
| Self-Service | Staff and board members see only their own records; re-authentication for attestations; attestation text versioned |
| Learning | Completion evidence tied to the person and the catalog requirement |
| Scope & Sites | Forms 5A/5B/5C are a health-center-entered copy of its HRSA-approved scope, dated as of the source EHBs record; no sync with or submission to EHBs; change in scope is a checklist the health center submits itself |
| Contracts & Agreements | Required-provision checks cite the grants rule on each Notice of Award: 2 CFR 200 as adopted by HHS at 2 CFR 300 for awards on or after the HHS effective date, and 45 CFR 75 for earlier awards (to be verified against the current HHS Grants Policy Statement). Look-Alikes have no §330 award, so these checks apply only if the Look-Alike holds another federal award. Debarment checks on contractors and subrecipients cite 2 CFR 180 |
| Finance & Grants | SFDP bands and FPG tables are catalog data with effective dates; annual FPG update is a catalog changeset |
| Quality & UDS | Aggregate measure results only by default; any patient-level feed needs an ADR, a BAA review, and a `security-privacy-officer` Approve |
| Patient Experience | Grievance narratives use the Phase 3 restricted-data controls; Part 2 warning; risk analysis updated before it ships |

## 11. Phase 8 · Scale and assurance

- SOC 2 Type II, then yearly.
- Annual penetration test, annual risk analysis update, annual tabletop.
- Additional state Medicaid exclusion adapters only if a new decision adds a state
  beyond Florida (D4), each with a manual-with-evidence fallback and a terms-of-use
  review.
- Multi-region disaster recovery, still inside the US.
- Regular regulatory watch: `hrsa-regulatory-analyst` checks for new PALs, PINs,
  Compliance Manual revisions, UDS manual changes, and FTCA manual changes, and
  turns each one into a catalog changeset. `security-privacy-officer` tracks
  changes to the HIPAA Security Rule (including the Security Rule NPRM published
  January 6, 2025, 90 FR 898; track whether it becomes final) and state privacy laws and updates the controls.

## 12. Control traceability

Where each baseline control is first built and where it is proven.

| Control | Built in | Proven at |
| --- | --- | --- |
| SSO + MFA, session timeout, re-authentication | 1 | G1 tests, G4 pen test |
| RBAC, site scoping, deny by default | 1 | G1 tests per endpoint |
| Tenant isolation (RLS + service check) | 1 | G1 tests, G4 pen test |
| Append-only, hash-chained audit log | 1 | G1 tests |
| Encryption in transit and at rest, KMS rotation | 1 | G1 configuration test, G4 scan and pen test |
| Supply chain (lockfiles, signed builds, pinned images) | 0 | G0 |
| Verified-only catalog in production | 0 (schema), 1 (release) | G2, G4 re-verification |
| Field-level encryption and reveal auditing | 1 (library), 2–3 (fields) | G2, G3 |
| Evidence file safety (scan, type check, expiry) | 1 | G1 tests |
| No PII/PHI in logs | 1 | G1 test, re-checked at G2, G3, G5 |
| Integration provenance, no false "clear", run auditing | 2 | G2 contract tests |
| Restricted PHI handling (Part 2 warning) | 3 | G3 |
| Backups, restore, RPO/RTO | 4 | G4 restore test |
| Retention and deletion schedule | 3 (incidents), 4 (all) | G3, G4 |
| Incident response and breach notification | 0 (policy), 4 (tested) | G4 tabletop |
| BAAs (customer and subprocessors) | 0 (hosting), 4 (all) | G4 |
| AI guardrails and evals | 6 | Per-capability gate |
| Risk analysis | 0, updated 3, 4, 7 and yearly | Every gate from G0 |

## 13. Decisions and open questions

### Decisions (2026-09-27)

| # | Decision | Effect |
| --- | --- | --- |
| D1 | **Do not collect Social Security numbers.** | No SSN fields anywhere; screening matches on name, DOB, NPI, and license number (§5); SSN-shaped values are rejected (G1). Collecting SSN later needs an ADR and a `security-privacy-officer` Approve |
| D2 | **Run the pilot before SOC 2 Type I.** | Pilot customers get a security package instead (§8); the Type I report is required for general availability (G5) |
| D4 | **Operate in Florida only.** | All customers, sites, and pilots are in Florida. State sources, the AHCA exclusion adapter, both Florida time zones, and FIPA breach rules are in `docs/compliance/florida.md`. Adding a state needs a new decision |
| D5 | **The product owner (@jselvalugo) owns every decision, the counsel engagement, and HRSA project officer contact.** | Where a gate says "Loogo Labs leadership", the product owner signs |
| D6 | **Confirmed Phase 0 values.** | Sessions: 15-minute idle and 12-hour absolute timeout, re-authentication within 5 minutes for sensitive actions (ADR-0006). RPO 1 hour, RTO 8 hours. Audit log retention 7 years (ADR-0008). Customer breach notice within 5 business days in the BAA template, pending counsel on the FIPA 10-day rule. AWS us-east-1 / us-east-2 for production (ADR-0005) |
| D7 | **Develop on Netlify for now.** | Netlify hosts non-production environments only, with synthetic data and the PREVIEW banner (ADR-0009). Production stays on AWS; Netlify never receives customer data |
| D8 | **Phase 0 approvals.** @jselvalugo is the HIPAA security officer and privacy officer; ADR-0001 to ADR-0008 are accepted; risk analysis v1, threat model v1, policies (including sanctions), data classification, and the subprocessor list are signed. | Branch protection turned on 2026-09-27 (`docs/ops/branch-protection.md`). G0 still needs: AWS BAA accepted, workforce training recorded, and catalog sources verified |
| D3 | **Engage legal counsel on every item listed under "For legal counsel" below.** | Counsel's written conclusions are filed before the gate that depends on each: BAA, terms, and state breach law before G4; NPDB/CVO role before any feature that queries NPDB for a customer; FTCA claim handling before G3; state Medicaid screening before G5. Until counsel answers, the conservative default in each item stays in force |
| D9 | **Phase 1 starts before G0 closes (AWS BAA, training record, source verification), synthetic data only; G0 must close before G1.** | Phase 1 runs on Netlify (ADR-0009, ADR-0010) with synthetic data only, in parallel with the open G0 items. No G1 checkbox is signed until G0 is closed. Plan: `docs/product/phase-1-plan.md` |

### Open questions

For `hrsa-regulatory-analyst`:
- Which Look-Alike differences affect the MVP modules? Applicability for both
  award types ships in the MVP (Florida decision FL-D2). How the board-composition waiver applies to
  Look-Alikes needs HRSA project officer confirmation.
- The re-credentialing and re-privileging interval. Planned approach: store it as
  a health-center policy parameter, with the Compliance Manual's example interval
  shown as guidance, once verified.
- Whether Chapter 5 expects NPDB queries for other licensed or certified
  practitioners as well as LIPs.

For `security-privacy-officer`:
- Florida privacy items FL-PRIV-1 to FL-PRIV-4 in `docs/compliance/florida.md`.

For legal counsel (engaged per D3):
- Customer BAA and terms of service language, including the "internal readiness,
  not an HRSA determination" limitation.
- Whether Deemed Health may act as a credentials verification organization or NPDB
  agent. Until counsel says yes, the health center runs its own NPDB queries and
  uploads the response.
- Limits on FTCA claim-handling features, and Florida Medicaid screening
  obligations.
