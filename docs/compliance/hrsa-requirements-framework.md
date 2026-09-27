# HRSA Requirements Framework

Owner: `hrsa-regulatory-analyst`.

This document is the working map from HRSA Health Center Program requirements to
Deemed Health modules, evidence, and cadences. It is written from general
knowledge of the program. **Before any item becomes a catalog entry, verify it
against the current source, then record the source URL, section, and the date
you verified it.** Where this document and the current HRSA source disagree, the
source wins. Update this file in the same change.

## 1. Authoritative sources (register each one in the catalog with version and effective date)

| Source | Key | Notes |
| --- | --- | --- |
| Public Health Service Act §330 (42 U.S.C. 254b) | `PHSA-330` | Statutory basis of the Health Center Program |
| 42 CFR Part 51c | `CFR-51c` | Grants for community health services |
| 42 CFR Part 56 | `CFR-56` | Migrant health centers |
| HHS/federal grants rules (2 CFR 200 as adopted by HHS; legacy 45 CFR 75 for older awards) | `UG` | Uniform administrative requirements, cost principles, audit. Confirm which applies per budget period |
| 2 CFR Part 180 / 376 | `CFR-180` | Suspension and debarment (SAM screening of contractors and subrecipients) |
| Health Center Program Compliance Manual | `CM` | Chapters below. The main operational source |
| Site Visit Protocol (OSV) | `SVP` | How HRSA reviewers assess each chapter, and the documents they request |
| Program Assistance Letters / Policy Information Notices | `PAL-YYYY-NN`, `PIN-YYYY-NN` | Policy updates. Each one is a catalog changeset with an effective date |
| FTCA Health Center Policy Manual; 42 U.S.C. 233(g)–(n) | `FTCA` | Deeming and annual redeeming |
| UDS Manual (per reporting year) | `UDS-YYYY` | Annual data reporting |
| HRSA Office of Pharmacy Affairs (340B) guidance | `340B` | Planned. Recertification and program integrity |
| HIPAA Privacy/Security Rules (45 CFR 160, 164); 42 CFR Part 2 | `HIPAA`, `PART2` | Owned with `security-privacy-officer` |
| OIG LEIE, SAM.gov exclusions, state Medicaid exclusion lists | `EXCL` | Screening sources. Florida only: AHCA sanctioned-provider list |
| Florida statutes and agency sources | `FL-*` | Deemed Health operates only in Florida. See `docs/compliance/florida.md` |

## 2. Compliance Manual chapters → modules

Chapter numbering follows the Compliance Manual. Chapters 3–20 are the
program requirements, and Chapter 21 is FTCA deeming.

| CM | Requirement area | Module(s) | Typical evidence (confirm against the SVP) | Cadence drivers |
| --- | --- | --- | --- | --- |
| 3 | Needs Assessment | Quality & UDS | Needs assessment document, date, service area data, board review | Periodic update (confirm the interval), plus with each application |
| 4 | Required and Additional Health Services | Scope & Sites | Form 5A, provision method per service (direct / formal agreement / formal referral), agreements | On change in scope |
| 5 | Clinical Staffing | Providers & Credentialing, Learning | Credentialing & privileging operating procedures, provider files, verification records, privilege lists, staffing plan | Re-credentialing and re-privileging interval (commonly every 2 years, so verify), plus each credential's expiration |
| 6 | Accessible Locations and Hours | Scope & Sites | Form 5B, hours of operation, board approval of hours | On change |
| 7 | Coverage for Medical Emergencies During and After Hours | Scope & Sites | After-hours coverage procedures, call arrangements, test logs | Periodic test |
| 8 | Continuity of Care and Hospital Admitting | Scope & Sites, Contracts | Admitting privileges or hospitalist/transfer agreements, follow-up procedures | Agreement renewal |
| 9 | Sliding Fee Discount Program | Finance & Grants | SFDP policy and schedule, FPG update, board approval, SFDP evaluation | Annual FPG update. Periodic evaluation (commonly at least every 3 years, so verify) |
| 10 | Quality Improvement/Assurance | Quality & UDS, Patient Experience | QI/QA plan, QI/QA reports to board, peer review, patient satisfaction, patient grievance process | Quarterly assessments, and board reporting |
| 11 | Key Management Staff | Governance | Org chart, position descriptions, CEO approvals by the board | On change |
| 12 | Contracts and Subawards | Contracts & Agreements, Screening | Procurement procedures, contracts with required provisions, subaward monitoring, SAM checks | On procurement / renewal |
| 13 | Conflict of Interest | Governance, Self-Service | Standards of conduct, annual disclosures from board and staff | Annual attestation |
| 14 | Collaborative Relationships | Contracts & Agreements | Letters of support, collaboration documentation with other providers | Application cycle |
| 15 | Financial Management and Accounting Systems | Finance & Grants | Single audit / annual audit, financial policies, drawdown controls | Annual audit |
| 16 | Billing and Collections | Finance & Grants, Enrollment | Billing and collections policies, fee schedule, payer participation and enrollment, waiver/reduction policy | Annual fee schedule review |
| 17 | Budget | Finance & Grants | Annual budget with board approval, total budget including non-grant revenue | Annual |
| 18 | Program Monitoring and Data Reporting Systems | Quality & UDS | UDS submission, data systems, board reporting of performance | Annual UDS (verify the due date per year) |
| 19 | Board Authority | Governance | Bylaws, minutes showing board approvals (CEO selection and evaluation, budget, SFDP, QI/QA, billing, personnel policies, services, sites, hours, applications), monthly meetings | Monthly meetings (verify exceptions) |
| 20 | Board Composition | Governance | Roster with patient-majority status, demographics, industry-income test, size | On any board change |
| 21 | FTCA Deeming Requirements | FTCA & Risk, Providers | Risk management program, quarterly risk assessments, annual risk training plan and completion, annual board risk report, claims management, C&P compliance, QI/QA, tracking systems (referrals, hospitalizations, diagnostics) | Annual deeming/redeeming application, quarterly, annual |

## 3. Commonly referenced rule parameters (verify each, then store in the catalog, never hard-code)

- **Board composition:** 9–25 members. At least 51% must be patients of the health
  center who, as a group, represent the population served. Of the non-patient
  members, no more than half may derive more than 10% of annual income from the
  health care industry. Waivers exist for some populations (for example, some
  special-population-only grantees).
- **Sliding fee:** a full discount (a nominal charge is allowed) at or below 100% FPG,
  partial discounts in at least three bands from 101% to 200% FPG, and no
  discount above 200% FPG (a nominal fee policy may apply).
- **Credentialing** (licensed independent practitioners): primary source
  verification of current licensure and of education/training, plus NPDB query, DEA
  registration where applicable, basic life support, government ID,
  immunization/communicable disease status, and hospital admitting privileges where
  applicable. Other licensed or certified practitioners have different verification
  expectations. Store verification method and source per element.
- **Privileging:** verification of current clinical competence, fitness for duty,
  immunization, and life support. Recurs on the renewal interval.
- **FTCA:** a risk assessment at least quarterly, a risk management training plan
  and training completion, an annual report to the board, and tracking of referrals,
  hospitalizations, and diagnostic tests.
- **Exclusion screening:** check before hire, contracting, or board seating, then
  monthly (a common industry cadence aligned with the monthly LEIE and SAM updates).

## 4. Catalog entry shape (`packages/requirements-catalog`)

```yaml
id: CM-05-C&P-LIP-LICENSURE         # stable, never reused
chapter: 5
title: Verify current licensure (LIP)
statement: >-
  Plain-language restatement. Never copy long passages from the source.
sources:
  - key: CM
    locator: "Chapter 5, Clinical Staffing — Credentialing"
    url: <official URL>
    verifiedOn: 2026-09-27
    verifiedBy: <reviewer>
appliesTo: { staffTypes: [LIP], siteScope: all }
evidence: [license_verification_record]
cadence: { trigger: on_hire_and_expiration, renewalMonths: null, leadDays: [90, 60, 30] }
severity: critical            # critical | high | medium | low
effective: { from: 2018-08-20, to: null }
supersedes: []
status: verified              # draft | verified | retired
```

## 5. Policy update workflow (PAL/PIN)

1. `hrsa-regulatory-analyst` records the update as a changeset with its effective
   date and affected `requirementId`s, and marks each one `added | changed | retired`.
2. `suite-architect` estimates the product impact, covering forms, workflows, reports, and
   data migrations such as HRSA migrating scope data.
3. The Command Center "Policy updates" page shows every health center what changed,
   what it means for them, and the tasks the update generated.
4. The catalog version is bumped. Past readiness snapshots keep the version they
   were computed under.

## 6. Readiness scoring (initial proposal)

- Each requirement instance is `Met`, `At risk` (due in 30 days or evidence stale),
  `Not met`, `Not applicable` (the reason is required), or `Not assessed`.
- Chapter readiness is the percent of applicable requirement instances that are Met,
  weighted by severity. The weights live in the catalog.
- The score is always shown with its denominator and a link to the underlying items.
- The score is **for internal readiness only**. The UI must never present it as
  an HRSA determination.
