# Market Requirements for Florida FQHCs

Owner: `suite-architect`, with `hrsa-regulatory-analyst` (regulatory accuracy)
and `security-privacy-officer` (HIPAA, ONC, and Florida privacy items).
Decision owner: the product owner (@jselvalugo).

This file records what Florida FQHCs expect from software sold to them, as given
by the product owner on 2026-09-27, and what each expectation means for Deemed
Health. Every agent builds toward these requirements. **Where one cannot be met
under the current scope, decisions, or ADRs, the agent stops and tells the
product owner (§4).** It never works around the conflict silently, and it never
widens the scope on its own.

> These requirements are market input, not verified law. Each one gets a
> catalog source key and is verified against the current source before it drives
> a rule, a gate, or contract language, the same as
> `docs/compliance/hrsa-requirements-framework.md` and
> `docs/compliance/florida.md`. Legal items go to counsel (roadmap decision D3).

## 1. Status legend

| Status | Meaning |
| --- | --- |
| **On plan** | Fits the current scope and roadmap. Build it. |
| **On plan, limited** | The compliance side fits the current scope. The full expectation (clinical, billing, or patient-level data) does not. Build the compliance side, and keep the limit visible to customers. |
| **Blocked: decision needed** | Cannot be met without changing a standing rule, a product principle, or an ADR. Needs a product owner decision before any work. |
| **Unverified** | The requirement itself is not confirmed. Verify before building. |

## 2. Requirements

### MR-1 · ONC Health IT Certification

**As given:** to be used by an FQHC for core clinical work, the software must be
certified under the ONC Health IT Certification Program, which validates
interoperability, security, and HIPAA-aligned safeguards.

**What it means for Deemed Health:** ONC certification (45 CFR Part 170, tested
by an ONC-Authorized Testing Lab and certified by an ONC-ACB) applies to health
IT that performs certified clinical functions, such as an EHR. Deemed Health is
compliance software. It manages staff, board, contract, and organizational data,
and does not do clinical work (principle 6, roadmap standing rule 7). Planning
assumption, to verify: an FQHC does not need a certified product to run its
compliance program, but it does need one for its EHR, and some federal programs
tie payment or reporting to certified EHR technology.

**Status:** **Blocked: decision needed** for certification itself;
**on plan** for the security and interoperability practices it tests.

- Certification only becomes reachable if Deemed Health adds clinical or
  patient-level functions (an EHR module, or UDS+ patient-level FHIR data). That
  breaks standing rule 7 and principle 6, and needs an ADR plus decision MR-D1.
- Until then, build to the same bar so the path stays open: FHIR R4 / US Core
  data shapes at integration boundaries, standards-based auth (OIDC, SMART-style
  scopes where an API is exposed), audit logging (ADR-0008), encryption
  (ADR-0007), and the HIPAA controls below.
- Customer-facing copy never says or implies that Deemed Health is ONC-certified
  (`ux-content-writer`, `security-privacy-officer`).

### MR-2 · HIPAA compliance

**As given:** strict HIPAA compliance.

**What it means:** Loogo Labs is a business associate of each health center.
The HIPAA Security Rule safeguards, BAA, breach procedure, risk analysis, and
policies are already in the roadmap (G0, G1, G4) and `docs/security/`.

**Status:** **On plan.** No change. Any feature that would bring in PHI beyond
what the roadmap allows (FTCA incidents in Phase 3, grievances in Phase 7) needs
an ADR and a `security-privacy-officer` Approve first.

### MR-3 · HRSA Operational Site Visit (OSV) readiness

**As given:** HRSA reviews the health center against the Compliance Manual
program requirement chapters during the OSV. The software must pull together
the sliding fee discount program, board governance, quality improvement data,
and credentialing files.

**What it means:** this is the core of Deemed Health. The Compliance Manual has
program requirements in Chapters 3–20 and FTCA deeming in Chapter 21 (see
`docs/compliance/hrsa-requirements-framework.md` §2); the OSV uses the Site
Visit Protocol (`SVP`). "QAPI" is a CMS term. The HRSA equivalent is the QI/QA
program in Chapter 10.

**Status:** **On plan.** Every chapter maps to a module, evidence, and a cadence
in the framework. Deliverable to add to the roadmap: an **OSV binder export**
that assembles, per chapter and SVP element, the current evidence, owner,
last-verified date, and open gaps. It is an internal readiness package, never an
HRSA determination (standing rule 5). Owners: `suite-architect` (plan),
`backend-engineer` (export), `hrsa-regulatory-analyst` (SVP element mapping).

### MR-4 · UDS reporting

**As given:** every FQHC submits the annual UDS report (patient demographics,
clinical quality measures, staffing and utilization, and financial tables).
The software must aggregate data precisely into the required formats, or
clinics will reject it.

**What it means:** most UDS tables are computed from patient-level EHR and
practice-management data. HRSA is also moving to UDS+, which takes de-identified
patient-level data in FHIR. Deemed Health does not hold that data today, and the
roadmap allows only aggregate measure results in Quality & UDS (§10).
Submission to EHBs is always done by a person (principle 2).

**Status:** **On plan, limited.** Full automatic aggregation from patient-level
data is **blocked: decision needed** (MR-D2).

What is on plan:
- UDS readiness: calendar and due dates per reporting year (`UDS-YYYY`
  catalog entries), owners, and review tasks.
- Import of the health center's EHR-generated UDS tables or aggregate counts,
  with table-level validation (cross-table checks, year-over-year variance,
  missing cells) against the UDS Manual for that year.
- Staffing and utilization (Table 5) and financial tables (Tables 8A, 9D, 9E)
  cross-checked against data the suite already holds (staff roster,
  credentialing, budget, sliding fee), with the differences listed for a human.
- An export the health center reviews and then enters or uploads in EHBs itself.

What needs MR-D2: computing the patient and clinical tables (for example
Tables 3A, 3B, 4, 6A, 6B, 7) or UDS+ FHIR files from patient-level data.

### MR-5 · Florida Medicaid PPS billing and wraparound

**As given:** FQHC revenue relies on the Medicaid Prospective Payment System,
which pays a per-encounter rate. AHCA has strict encounter definitions, rules
for multiple visits on the same day, and wraparound reconciliation for managed
care. The software must manage these.

**What it means:** encounter logging, claim creation, and PPS payment
calculation are revenue-cycle functions of the practice-management or billing
system, and use patient-level claims data (PHI, and HIPAA transaction
standards such as 837/835). All of that is outside the current scope.

**Status:** **On plan, limited.** Encounter-level billing is **blocked:
decision needed** (MR-D3).

What is on plan (Finance & Grants, Enrollment, Scope & Sites):
- Catalog entries (`FL-MEDICAID-PPS`) for the AHCA FQHC coverage and
  reimbursement policy: encounter definition, same-day visit rules, and
  wraparound or supplemental payment reconciliation, once verified.
- Tracking of the health center's PPS rate letters, Medicaid cost report
  deadlines, SMMC plan contracts, wraparound reconciliation periods, and
  change-in-scope rate adjustment requests, as evidence with owners and due
  dates.
- Aggregate reconciliation worksheets the health center fills in (expected vs.
  received, by plan and period), with no claim-level data.
- Links between Medicaid enrollment per site and payer (Enrollment module) and
  Form 5B sites (Scope & Sites), so a site that is not enrolled is flagged.

### MR-6 · Florida state reporting

**As given:** Florida FQHCs map data to Florida Department of Health reporting
requirements alongside federal reports.

**Status:** **Unverified.** Which Florida reports apply to an FQHC, and to whom,
is not confirmed. Candidates to check: Florida Medicaid cost reports (AHCA),
notifiable disease reporting (Fla. Admin. Code ch. 64D-3, a clinical function of
the EHR), and any Florida DOH or county health department grant reports.
`hrsa-regulatory-analyst` lists the verified ones as `FL-*` catalog entries.
Each report is then placed as on plan or blocked using §1.

### MR-7 · Florida privacy, records, and telehealth

**As given:** Florida has its own medical record retention rules, telehealth
rules, and the Florida Information Protection Act (FIPA), which adds state
enforcement on top of HIPAA.

**Status:** **On plan**, with verification open.
- FIPA (Fla. Stat. §501.171): already tracked as `FL-FIPA` and FL-PRIV-1 to
  FL-PRIV-4 in `docs/compliance/florida.md`. FIPA is a separate state
  enforcement scheme, with its own notice rules and civil penalties, rather than
  an increase to HIPAA penalties. Counsel confirms how the two interact.
- Record retention: register `FL-RECORDS` (Fla. Stat. §456.057 and the practice
  board rules, for example Fla. Admin. Code 64B8-10.002 for physicians). Retention
  of Deemed Health's own records (evidence, audit log) must be at least the
  longest applicable period. Configure it per record type.
- Telehealth: register `FL-TELEHEALTH` (Fla. Stat. §456.47). Deemed Health does
  not deliver telehealth. The effect is on credentialing (out-of-state
  telehealth provider registration, license verification) and on scope of
  project, and it goes to `credentialing-privileging-specialist`.

## 3. Decisions needed from the product owner

| # | Question | Default until decided |
| --- | --- | --- |
| MR-D1 | Pursue ONC Health IT Certification? This means adding clinical or patient-level functions, an ADR that replaces standing rule 7, and an ONC-ATL/ACB engagement | No. Build to the same security and interoperability bar; never claim certification |
| MR-D2 | Compute UDS patient and clinical tables (or UDS+ FHIR) from patient-level EHR data? This needs an EHR integration ADR, a BAA review, a risk analysis update, and a `security-privacy-officer` Approve | No. Import EHR-generated tables or aggregates, validate them, and cross-check them against suite data |
| MR-D3 | Handle encounter-level Medicaid PPS billing and wraparound? This makes Deemed Health a revenue-cycle system with claims PHI | No. Track PPS policy, rates, deadlines, and aggregate reconciliation only |

## 4. Rule for every agent: when a requirement cannot be met

Tell the product owner (@jselvalugo) when any of these happens:

1. A task needs work that this file marks **blocked: decision needed**.
2. A standing rule, product principle, ADR, or gate would have to be broken or
   bent to meet one of MR-1 to MR-7.
3. Verification shows a requirement is wrong, has changed, or does not apply,
   or a source cannot be reached to verify it.
4. A requirement cannot be met on the planned timeline (for example, before the
   pilot).

How:
- Stop the affected part of the work. Keep going on parts that are not affected.
- In the session, and in the PR description under a **Market requirement
  blocked** heading, state: the MR number, what cannot be met, why (the rule or
  fact that blocks it), the options, and a recommendation.
- Update §2 and §3 of this file in the same change.

## 5. Changes to other documents

When a decision here changes, update in the same change:
`docs/product/implementation-roadmap.md` (standing rule 7, §10, §13),
`docs/product/module-map.md`, `docs/compliance/florida.md` (source table), and
`docs/compliance/hrsa-requirements-framework.md`.
