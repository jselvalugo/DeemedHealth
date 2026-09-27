# Approval Authority and the Auditor Role

Owner: `hrsa-regulatory-analyst`. Consumers: `governance-board-specialist`,
`backend-engineer`, `data-architect`, `security-privacy-officer`,
`suite-architect`. Decision owner: the product owner (@jselvalugo).

This document answers two questions from the product owner (2026-09-27):

- **(a)** Who may approve what? Which approvals must be board actions, and which
  belong to key management staff (CEO, CFO, CMO, COO), the credentialing
  committee, or the compliance officer. Florida law is covered too. Executives
  approve only within their own area (decision **D13**).
- **(b)** What should the auditor role see?

> **Verification status: nothing here is verified.** On 2026-09-27 the session's
> network egress proxy blocked every official source: bphc.hrsa.gov, ecfr.gov,
> law.cornell.edu, hhs.gov, leg.state.fl.us, flsenate.gov, flhouse.gov, and
> law.justia.com. Every statement below comes from web-search result summaries.
> Each one is marked **[unverified: secondary source]** and gives the URL that the
> search returned. A search result that names an official URL is **not** a
> reading of that page. Before any row becomes a catalog entry (`status:
> verified`), someone must open the official page, check the locator, and record
> the URL and date.
>
> **Currency warning.** Search results say HRSA released a **revised Compliance
> Manual in October 2025**, the first major revision since 2018, and a **Site
> Visit Protocol (SVP) updated November 20, 2025**. The 2025 SVP changed Ch. 19
> Board Authority elements a and c. Element a gained a note on public-agency
> powers over the co-applicant. Element c gained notes on proxies, signatures,
> which applications need board approval, and budget/application overlap. The
> framework doc and this doc were written against the 2018 structure. Every
> element letter below must be checked against the 2025 text.
> [unverified: secondary source]
> https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/summary-updates ;
> https://reglantern.com/blog/key-updates-in-hrsas-october-2025-health-center-compliance-manual-revision

## 1. Layers, kept apart

| Layer | Meaning here | Example |
| --- | --- | --- |
| **HRSA requirement** | HRSA says *the board* must do it, or requires a documented decision without naming who | Board approves the annual budget (Ch. 19) |
| **State requirement** (`FL-*`) | Florida law requires it of a Florida not-for-profit or public agency | Disinterested directors approve a director conflict-of-interest transaction (§617.0832) |
| **Health-center policy** | The organization decides who approves. The product ships a *default* that the tenant can change | Who grants clinical privileges (HRSA leaves this to the health center) |
| **Best practice** | Common practice, never shown as an HRSA requirement | Board resolution naming who may sign payer agreements |

## 2. Approval matrix

Key to the "Approver" column:

- **Board**: a vote of the full governing board at a meeting with a quorum.
- **Board (co-applicant)**: in a public-agency/co-applicant arrangement, the
  co-applicant board, except where the public agency may keep the authority.
- **Designated**: the health center's own policy names the approver, and the
  product ships the default shown.

Status is `unverified` for every row (see the banner).

### 2.1 Board-required (HRSA). Staff can never record these as their own decision.

| # | Approval type (`approvalTypeId`) | Approver | Source (locator) | Status |
| --- | --- | --- | --- | --- |
| B1 | `ceo.select` / `ceo.dismiss`: select, and terminate or dismiss, the Project Director/CEO | Board | CM Ch. 19 (required authorities); CM Ch. 11 (the CEO reports to the board and is directly employed) [unverified: secondary source] https://bphc.hrsa.gov/compliance/compliance-manual/chapter19 ; https://bphc.hrsa.gov/compliance/compliance-manual/chapter11 | unverified |
| B2 | `ceo.evaluate`: evaluate CEO performance | Board. **The board sets the frequency.** Search results say HRSA does not require an annual evaluation | CM Ch. 19 [unverified: secondary source] https://bphc.hrsa.gov/compliance/compliance-manual/chapter19 | unverified |
| B3 | `budget.annual`: annual health center project budget | Board | CM Ch. 19; CM Ch. 17 [unverified: secondary source] https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/board-authority | unverified |
| B4 | `application.approve`: applications related to the project (for example SAC/RD, and others the 2025 SVP lists) | Board. **The exact list of applications changed in the 2025 SVP element c; get it from the official text.** Whether a Change in Scope request itself needs a board vote, or only the underlying service/site/hours decision, is open (§7, C1) | CM Ch. 19; SVP 2025 Ch. 17 (Board Authority) element c [unverified: secondary source] https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/summary-updates | unverified |
| B5 | `scope.services` / `scope.sites` / `scope.hours`: health center services, site locations, and hours of operation | Board | CM Ch. 19 [unverified: secondary source] https://bphc.hrsa.gov/compliance/compliance-manual/chapter19 | unverified |
| B6 | `policy.sfdp`: adopt, evaluate at least every 3 years, and approve updates to Sliding Fee Discount Program policies | Board | CM Ch. 19; CM Ch. 9 [unverified: secondary source] https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/board-authority ; https://reaadvisory.com/insight/sliding-fee-scale-compliance-fqhc/ | unverified |
| B7 | `policy.qiqa`: adopt, evaluate at least every 3 years, and approve updates to QI/QA policies | Board | CM Ch. 19; CM Ch. 10 [unverified: secondary source] (same URLs as B6) | unverified |
| B8 | `policy.billing`: adopt, evaluate at least every 3 years, and approve updates to billing and collections policies | Board | CM Ch. 19; CM Ch. 16 [unverified: secondary source] (same URLs as B6) | unverified |
| B9 | `policy.financial`: adopt, evaluate at least every 3 years, and approve updates to financial management and accounting system policies | Board. **Public-agency exception:** a public agency with a co-applicant may keep this authority | CM Ch. 19; CM Ch. 15 [unverified: secondary source] (same URLs as B6) | unverified |
| B10 | `policy.personnel`: adopt, evaluate at least every 3 years, and approve updates to personnel policies | Board. Same public-agency exception as B9 | CM Ch. 19 [unverified: secondary source] (same URLs as B6) | unverified |
| B11 | `plan.strategic`: long-range or strategic planning | Board. Search results say the SVP asks for planning documents from the past 3 years | CM Ch. 19; SVP Ch. 17 [unverified: secondary source] https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/board-authority | unverified |
| B12 | `board.review.*`: monitor financial status (including audit results) and program performance; receive QI/QA and risk management reports | Board **review** (recorded as board receipt or acceptance in the minutes, not as an approval) | CM Ch. 19; CM Ch. 21 [unverified: secondary source] https://bphc.hrsa.gov/compliance/compliance-manual/chapter21 | unverified |
| B13 | `ftca.rm.board_report`: quarterly risk management assessment results and an annual risk management report to the board and key management | Board **review** | CM Ch. 21 [unverified: secondary source] https://bphc.hrsa.gov/sites/default/files/bphc/compliance/ftca-compliance-tool-risk-management-annual-report.pdf | unverified |
| B14 | `bylaws.amend` and board membership actions | Board (under the bylaws and ch. 617). The bylaws must not let any other person, entity, or committee reserve approval authority over, or veto, the board's required authorities | CM Ch. 19; CM Ch. 20 [unverified: secondary source] https://bphc.hrsa.gov/compliance/compliance-manual/chapter19 | unverified |

**Committees and emergency action.** Search results say an executive committee
may act for the board in an emergency, with a later vote of the full board. No
committee may reserve approval authority over, or veto, the board's required
authorities. [unverified: secondary source]
https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/board-authority.
Product effect: a committee action on a B-row approval type is recorded as
`capacity: board_committee` with `ratificationRequired: true`. The requirement
instance stays **At risk** until the full board ratifies it.

**Proxies and signatures.** Search results say the 2025 SVP leaves proxy voting
and quorum to state law and the bylaws, and says HRSA does not require signed
minutes. [unverified: secondary source]
https://reglantern.com/blog/hrsa-site-visit-protocol-updates-november-2025 ;
https://aafcpa.com/2026/03/04/2025-hrsa-site-visit-protocol-updates-refine-compliance-expectations/.
So the product must **not** require a signature on minutes as HRSA evidence. It
must take quorum and proxy rules from the tenant's bylaws configuration, which
Florida law governs (§3).

### 2.2 Designated by the health center (HRSA leaves the approver to the organization)

| # | Approval type | HRSA position | Default approver we ship | Source | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | `cp.privileges.grant`: grant or renew clinical privileges for an individual | **The board is not required** to approve C&P procedures or individual privileges. The health center's policy names who grants privileges; it may be the CMO, the CEO, or the board. HRSA requires a documented, consistently followed process that includes a formal grant of privileges | Credentialing committee **recommends**; **CMO approves** (clinical area). The tenant can change this to "board approves", or "board designee", as its bylaws say | HRSA Compliance FAQ (Clinical Staffing); CM Ch. 5 [unverified: secondary source] https://bphc.hrsa.gov/compliance/health-center-program-compliance-faqs ; https://compliatric.com/what-signatures-are-required-for-approval-of-privileges/ | unverified |
| D2 | `cp.credentials.approve`: approve a credentialing file | Same as D1 | Credentialing coordinator **verifies**; credentialing committee or CMO **approves** | Same as D1 | unverified |
| D3 | `cp.procedures`: C&P operating procedures | Board approval is not required (same FAQ) | CMO approves; the tenant may add board approval | Same as D1 | unverified |
| D4 | `cp.privileges.cmo_self`: the CMO's own privileges | Not addressed in the sources found | CEO or credentialing committee chair. **Nobody approves their own privileges** (conflict rule, §4.3) | Health-center policy | n/a (product rule) |
| D5 | `kms.hire`: hire key management staff other than the CEO | The CEO oversees key management staff. The board is not named for non-CEO staff. **A CEO change after award needs HRSA prior approval**, which the health center requests | CEO | CM Ch. 11 [unverified: secondary source] https://bphc.hrsa.gov/compliance/compliance-manual/chapter11 | unverified |
| D6 | `contract.approve` / `procurement.award` | The health center's written procurement procedures (2 CFR 200.318 and following) set the approver. Nothing found requires board approval of individual contracts, except where a contract changes services or sites (B5) or is a director conflict transaction (F2) | By dollar threshold in the tenant's procurement policy: CFO up to X, CEO up to Y, board above Y. **We ship no amounts**; the tenant must enter them | CM Ch. 12; 2 CFR 200.318 (not read) | unverified |
| D7 | `fee_schedule.approve`: the fee schedule (Ch. 16) | Not confirmed whether HRSA requires the board to approve the fee schedule itself, or only the billing and collections policies (B8) | CFO proposes. **Board**, until verified (safe default) | CM Ch. 16 (not read) | unverified. See §7, C2 |
| D8 | `sfdp.schedule`: the discount schedule under the SFDP policy | Board adopts the SFDP *policy* (B6). Whether the schedule itself, or the annual FPG update, needs a board vote is not confirmed | CFO updates it for new FPG figures under the board-approved policy; the board is informed. Tenant can require a board vote | CM Ch. 9 (not read) | unverified. See §7, C2 |
| D9 | `ftca.application`: FTCA deeming or redeeming application | **The health center submits it in EHBs; the software never does.** Search results for older PALs mention a board-approved QI/QA or risk management plan and affirmation signatures by the CEO and the Medical Director. The current PAL (CY 2027) must be checked | Prepared in the product. CEO and CMO **affirm outside the product** (in EHBs). The board approval of the plan is a B7 row | FTCA PALs [unverified: secondary source] https://bphc.hrsa.gov/sites/default/files/bphc/compliance/pal-2018-01.pdf ; https://bphc.hrsa.gov/sites/default/files/bphc/data-reporting/cy-2027-ftca-health-center-pal.pdf | unverified |
| D10 | `standards_of_conduct.adopt` (Ch. 13) | Written standards are required. Who adopts them was not confirmed | Board (best practice, labeled as such) | CM Ch. 13 (not read) | unverified |
| D11 | `exclusion.determination`: decide on a possible exclusion match | No HRSA approver. Contracting and employment consequences come from OIG and 2 CFR 180 | Compliance officer | Health-center policy | n/a (product rule) |
| D12 | `grievance.resolve`, `incident.close` | No HRSA approver named | QI/Risk manager. Closing a finding stays human (product principle 2) | Health-center policy | n/a |

### 2.3 Florida-only approvals

| # | Approval type | Approver | Source | Status |
| --- | --- | --- | --- | --- |
| F1 | `medicaid.provider_agreement.sign`: sign the Florida Medicaid provider agreement | An authorized official of the provider. A secondary source says AHCA lets the CEO or president sign for all principals, and that an agreement signed by someone who is not a recognized authorized agent is invalid. **Signed by a person, outside the product** | Fla. Stat. §409.907; Fla. Admin. Code r. 59G-1.060 [unverified: secondary source] https://medsolercm.com/blog/florida-medicaid-provider-enrollment ; https://ahca.myflorida.com/content/download/5923/file/59G-1.060_Enrollment.pdf | unverified |
| F2 | `coi.transaction.approve`: contract or transaction with a director, or with an entity in which a director is a director, officer, or has a financial interest | Board or committee, by a majority of the directors who have no interest in it, after disclosure (or member approval, or the transaction is fair to the corporation) | Fla. Stat. §617.0832 [unverified: secondary source] https://law.justia.com/codes/florida/title-xxxvi/chapter-617/section-617-0832/ | unverified |
| F3 | Committee limits | Committees are created by a majority of the full board, and a majority of their members must be directors. A committee **may not fill board or committee vacancies**, or approve or recommend to members actions that need member approval | Fla. Stat. §617.0825 [unverified: secondary source] https://www.flsenate.gov/Laws/Statutes/2025/617.0825 | unverified |
| F4 | Action without a meeting | Allowed by **unanimous written consent** of the board or committee unless the articles or bylaws say otherwise. It is effective when the last director signs | Fla. Stat. §617.0821 [unverified: secondary source] https://florida.public.law/statutes/fla._stat._617.0821 | unverified. **Not available to Sunshine tenants** (§3.2). Whether it satisfies HRSA's monthly meeting requirement is doubtful (§7, C4) |
| F5 | SMMC plan credentialing, and delegated-credentialing agreements | Individual practitioners attest to their own applications (for example CAQH). A delegated-credentialing agreement with a plan is signed by the health center's authorized official | Plan contracts; AHCA SMMC (not read) | unverified. See §7, C6 |

## 3. Florida overlays

### 3.1 Florida Not For Profit Corporation Act (ch. 617)

All items are [unverified: secondary source]. Search summaries point to
https://www.flsenate.gov/Laws/Statutes/2025/Chapter617/All.

- **Board powers (§617.0801).** All corporate powers are exercised by or under
  the authority of the board, subject to limits in the articles. This matches
  HRSA's rule that no other body may hold a veto (B14). Product effect: officer
  and executive authority exists **only because the board delegated it**. The
  per-tenant area mapping (§4.4) is the product's record of that delegation, and
  it should link to the board resolution or bylaws section that grants it.
- **Committees (§617.0825).** See F3. A committee action is still the board's
  action for ch. 617, but HRSA B-rows need full-board ratification (§2.1).
- **Written consent (§617.0821).** See F4.
- **Director conflicts (§617.0832).** See F2. The product computes a
  *disinterested majority*: interested directors are recorded as recused and are
  left out of the count. This sits next to CM Ch. 13, which requires written
  standards of conduct and conflict-of-interest disclosures.
- **Officers (§617.0840, §617.0841).** The statute names required officers and
  their duties. Their text was not visible in the search results, so it is not
  summarized here. Counsel item C5.

### 3.2 Public-agency health centers: Sunshine Law (ch. 286) and public records (ch. 119)

This applies when the organization setting `publicAgency` is on (FL-D3), or when
counsel decides that a private nonprofit is covered because it acts for a public
agency. Florida courts apply a "totality of factors" test (was the entity created
by the agency, is it under the agency's control, does it perform a delegated
governmental function) and the *Memorial Hospital-West Volusia* line of cases.
[unverified: secondary source]
https://www.myfloridalegal.com/ag-opinions/open-government-private-organizations ;
https://caselaw.findlaw.com/court/fl-supreme-court/1094275.html

- **Only at a noticed public meeting.** No resolution, rule, or formal action is
  binding unless taken at a meeting open to the public with reasonable notice.
  The law also covers discussion and deliberation, not just votes.
  [unverified: secondary source] Fla. Stat. §286.011;
  https://www.myfloridalegal.com/sites/default/files/2023-05/2023GovernmentInTheSunshineManual.pdf
- **No government by delegation.** People or committees (including staff
  committees) that the board delegates decision-making to are covered too.
  [unverified: secondary source] (same Sunshine Manual; Florida Bar overview
  https://www-media.floridabar.org/uploads/2018/09/18-RW-Opengovernmentoverview.pdf)
- **Product rules for Sunshine tenants:**
  1. A board-capacity or committee-capacity approval must link to a board meeting
     record that carries a **public notice date** and location. Without it, the
     approval cannot be recorded.
  2. Written consent (F4) and any "vote by email" or packet-comment approval are
     **turned off**.
  3. **Comment threads between board members** on packets are turned off. Two
     members discussing a matter that will come before the board, outside a
     meeting, can be a Sunshine violation. Board members can still send questions
     to the board liaison (staff), which the tenant's counsel must approve as a
     pattern (C7).
  4. Committees that the board creates to recommend (for example a credentialing
     committee that reports to the board) are flagged as possibly covered. The
     product records their meeting notices too.
  5. **Public records (ch. 119).** Board packets, minutes, approvals, and much of
     the evidence library may be public records. The tenant needs an export that
     answers a records request, with exempt fields (for example personal
     information exempt under ch. 119, and PHI) redacted. Retention follows the
     Florida general records schedules, not our default. Hand this to
     `security-privacy-officer` and counsel (C8).

## 4. Recommended product model

### 4.1 Approval types are catalog data

Add an `approvalType` list to `packages/requirements-catalog`. Every row in §2
becomes one entry.

```yaml
id: policy.sfdp
requirementIds: [CM-19-POLICY-SFDP, CM-09-SFDP-POLICY]   # draft ids
requiredCapacity: board          # board | board_or_committee_ratified | designated
area: finance                    # governance | finance | clinical | operations | compliance | hr
reviewCadence: { everyMonths: 36 }
publicAgencyVariant: null        # policy.financial / policy.personnel: { retainedBy: public_agency_allowed }
sunshine: meeting_required       # applies when org.publicAgency
sources: [{ key: CM, locator: "Ch. 19", status: draft }]
status: draft
```

### 4.2 Approval records carry `capacity` and `area`

Extend `public.approval` (hand-off to `data-architect`; today's ERD row has no
capacity):

| New field | Meaning |
| --- | --- |
| `approval_type_id` | From the catalog |
| `capacity` | `board`, `board_committee`, `staff` |
| `area` | Copied from the approval type when recorded; used for the staff check |
| `body_id` | The board or committee, when capacity is not `staff` |
| `meeting_id`, `motion_text`, `votes_for`, `votes_against`, `abstentions`, `recused_person_ids`, `quorum_met` | Board and committee actions |
| `minutes_document_id` | The minutes (evidence) |
| `ratifies_approval_id` | Full-board ratification of a committee emergency action |
| `recorded_by_user_account_id`, `confirmed_by_person_id` | Who entered the board action, and the board officer who confirmed it |

**Conflict with the current ERD.** The ERD trigger accepts an approval only when
the actor is the approver's own account. That fits a staff decision. A board
decision is made by a *body* in a meeting, so the approver is `body_id`, and the
person who enters it is recording what happened, not deciding. Proposed rule:

- `capacity: staff`: the approver is the actor (the current trigger, unchanged).
- `capacity: board | board_committee`: the **board liaison** (staff) may *draft*
  the record from the minutes. It takes effect only when a **board officer**
  (secretary or chair, with a board-member account) confirms it. The confirmer
  must be the transaction actor. AI and service accounts can do neither.

### 4.3 Enforcement rules

1. **Board-required types cannot be recorded in `capacity: staff`.** No staff
   role, including Executive and Compliance officer, can record them. The API
   rejects it; it is not only hidden in the UI.
2. **Staff approvals need area coverage.** The approver must hold a role whose
   area mapping (§4.4) includes the approval type's `area`, at the site in
   question (site scoping still applies).
3. **No self-approval.** Nobody approves a record they submitted, or one about
   themselves: own privileges, own evaluation, own compensation, own
   conflict-of-interest disclosure.
4. **Disinterested majority.** For F2 and any board vote with a declared
   conflict, recused members are excluded and the vote must pass among the rest.
5. **Ratification clock.** A committee action on a B-row is At risk until the
   full board ratifies it. Default: at the next regular board meeting.
6. **Outside-the-product acts stay outside.** EHBs submissions, the FTCA
   application, and payer agreement signatures are recorded as *attested by a
   named person on a date*, with the evidence file. The product never submits,
   signs, or attests (product principle 2; review checklist FTCA item).
7. **Every approval, rejection, confirmation, and mapping change** is an audit
   event (ADR-0008, category `approval` or `permission`).

### 4.4 Per-tenant executive area mapping (D13)

Stored per organization, editable by the compliance officer with a second
approval from the CEO, versioned, and linked to the board resolution or bylaws
section that delegates the authority (§3.1). Defaults we ship:

| Role | Default areas | Examples of staff approvals it can make |
| --- | --- | --- |
| CEO | governance (staff side), operations, hr | Key management hires (D5); contracts within the CEO's threshold (D6); preparing items for the board; organization-wide procedures below board policy |
| CFO | finance | Contracts within the CFO's threshold; SFDP schedule updates under the board policy (D8); billing procedures; budget *preparation* (the board approves, B3) |
| CMO | clinical | Privileges and credentials (D1–D3); clinical protocols; peer review and QI/QA *procedures* (the board approves QI/QA *policy*, B7) |
| COO | operations | After-hours coverage procedures; site operations; proposals for hours and sites (the board approves, B5) |
| Compliance officer | compliance | Exclusion match decisions (D11); auditor access grants inside the default scope (§5) |
| Credentialing committee | clinical (recommend only) | Recommendations for D1 and D2; the CMO or board records the approval |
| QI/Risk manager | quality, risk | Grievance and incident closure (D12) |

Defaults that ship **off** and need the tenant to turn them on: board approval
of individual privileges, contract thresholds (no amounts), and written consent.

## 5. Auditor role recommendation

### 5.1 Who asks for what (all [unverified: secondary source])

| Reviewer | What they request | Source seen |
| --- | --- | --- |
| HRSA OSV team | Pre-visit documents by chapter: policies, board minutes, bylaws, org chart, budget, audit, and a **sample of C&P files** (search results say 4–5 LIP, 4–5 OLCP, 2–3 other clinical staff) | https://bphc.hrsa.gov/compliance/site-visits/site-visit-protocol/credentialing-privileging ; https://bphc.hrsa.gov/sites/default/files/bphc/compliance/osv-required-documents-file-naming-convention.pdf |
| FTCA reviewer | Risk management plan, quarterly assessments, training plan and completion, board reports, C&P, tracking systems | https://bphc.hrsa.gov/compliance/ftca/site-visit-protocol |
| Single Audit (2 CFR 200 Subpart F) | The auditee must give the auditor access to personnel, accounts, books, records, and supporting documentation (§200.508). The federal agency and its auditors get timely and reasonable access to records (§200.337) | https://www.ecfr.gov/current/title-2/subtitle-A/chapter-II/part-200/subpart-F/subject-group-ECFRc3bd6ae97de5a40/section-200.508 |
| AHCA Medicaid Program Integrity | Records of services billed to Florida Medicaid, kept at least 5 years from the date of service. These are mostly **clinical and billing records that Deemed Health does not hold** | Fla. Stat. §409.913; r. 59G-1.054 https://ahca.myflorida.com/content/download/5930/file/59G_1054_Recordkeeping_Documentation_Requirements_FINAL.pdf |

What this shows: reviewers ask for **documents and samples**, not for a live
login to every module. Most of what they want lives in the evidence library and
in a few structured records (C&P files, board actions, screening logs).

### 5.2 Minimum necessary

The minimum necessary standard (45 CFR 164.502(b), 164.514(d)) requires
reasonable efforts to limit PHI used, disclosed, or requested to what the purpose
needs. It requires role-based rules for the workforce (which classes of people
need which categories of PHI) and criteria for routine disclosures. Exceptions
include disclosures required by law and disclosures to HHS for compliance review.
[unverified: secondary source]
https://www.hhs.gov/sites/default/files/ocr/privacy/hipaa/understanding/coveredentities/minimumnecessary.pdf ;
https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html

Our data is mostly staff and board PII (FIPA-covered in part, FL-PRIV-2), and
some modules hold PHI (grievances, incidents, risk events). Minimum necessary
applies directly to the PHI. For staff PII we apply the same principle as policy:
the data classes in `docs/data/data-dictionary.md` already mark what is
confidential.

### 5.3 Recommendation

**Keep the default scope as the module map says, and add structured,
per-engagement expansions.** Do not give auditors all modules read.

1. **Default scope (every auditor grant):**
   - HRSA Readiness: requirement status, and the evidence library, read.
   - Exports of evidence packets, each export logged.
   - Governance records that are evidence: bylaws, board-approved policies,
     minutes, the B-row approval records. **Not** draft packets or board
     member comments.
   - Any value classed `confidential` or above is masked by default (for
     example: date of birth, home address, personal phone and email, DEA number,
     NPDB report content, background screening content). The reviewer can see
     that a verification exists, its date, and its source.
   - **No PHI.** Grievance, incident, and risk event content is out of scope.
2. **Time box:** keep the current rule (end date required, maximum 30 days,
   auto-expiry, ADR-0006 rule 7). Add: a grant **starts no earlier than the
   engagement start date**; the tenant can extend in 30-day steps with a new
   approval; every view is logged (already planned).
3. **Per-engagement expansions**, each requested with a purpose, approved by the
   compliance officer **and** a second approver (CEO, or the privacy officer for
   anything with PHI), time-boxed within the grant, and listed on the grant:
   - `cp_file_sample`: named provider files, **only the sample** the reviewer
     picked (OSV, FTCA). Masking stays on for fields the reviewer does not need.
   - `screening_log`: exclusion screening history (OSV Ch. 12, Single Audit).
   - `finance_records`: Finance & Grants read (Single Audit).
   - `contracts`: Contracts & Agreements read (OSV Ch. 12, Single Audit).
   - `phi_minimum`: specific grievance or risk records, de-identified where the
     purpose allows. Needs the privacy officer's approval and a BAA or other
     legal basis for the reviewer; for HRSA or AHCA oversight, counsel confirms
     the basis (C9).
   - `audit_log_read`: the tenant audit log (ADR-0008 already names the auditor
     role here; recommend moving this to an expansion, not the default).
4. **Preferred path: packets, not browsing.** The better default for
   external reviewers is a **reviewer packet**: the health center builds an
   export (evidence plus selected records, masked) and shares it through a
   time-limited link. A live auditor login is for internal auditors and
   engagements that need to sample on their own.
5. **Internal auditors** (the health center's own compliance or internal audit
   staff) are workforce, not the auditor role. They get the Compliance officer
   role or a read-only variant, with site scoping.

## 6. Hand-offs

| To | What |
| --- | --- |
| `data-architect` | §4.2 fields on `approval`; the board-body approver and confirm flow, which changes the ERD trigger rule; `approval_type` reference; area mapping table with version and delegating document |
| `backend-engineer` | §4.3 enforcement in the Approval service; auditor expansions as grant scopes on `RoleAssignment` |
| `governance-board-specialist` | Meeting, motion, vote, recusal, ratification workflow; Sunshine meeting notice fields |
| `security-privacy-officer` | §5 auditor scope and masking; ch. 119 public records export; retention for public-agency tenants |
| `ux-content-writer` | EN/ES copy that says "Board approval required", never "HRSA approved"; explanation of why staff cannot record board actions |
| `qa-test-engineer` | Fixtures: staff tries to record a board-only approval (denied); committee action without ratification (At risk); recused director excluded from the majority; Sunshine tenant with no notice date (denied); auditor grant before start date and after end date (denied) |

## 7. Open items for counsel and the HRSA project officer

Routed to the product owner (@jselvalugo), who engages counsel (decision D3)
and holds project officer contact.

| # | Question | For |
| --- | --- | --- |
| C1 | Which applications need a board vote under the 2025 SVP element c? Does a Change in Scope request need one, or only the service, site, or hours decision behind it? | HRSA project officer / official SVP text |
| C2 | Must the board approve the fee schedule (Ch. 16) and the sliding fee discount schedule and its annual FPG update (Ch. 9), or only the policies? | HRSA official text |
| C3 | For public-agency tenants with a co-applicant: which approvals does the public agency keep (financial and personnel policies), and which stay with the co-applicant board (2025 SVP element a note)? | HRSA official text; counsel |
| C4 | Does a Florida unanimous written consent (§617.0821) count toward HRSA's monthly meeting requirement, or satisfy a B-row approval? | HRSA project officer; counsel |
| C5 | Required officers and their duties (§617.0840, §617.0841); may directors vote by proxy under ch. 617 (HRSA defers to state law)? | Counsel |
| C6 | Florida rules on who must sign the Medicaid provider agreement and SMMC delegated-credentialing agreements, and whether a board resolution naming signatories is needed | Counsel; AHCA |
| C7 | Sunshine: is a pilot health center covered (public agency, or a private entity under the totality-of-factors test)? Is the liaison-relay pattern for board member questions acceptable? | Counsel |
| C8 | ch. 119 public records: which Deemed Health records are public records for a public-agency tenant; which exemptions apply to staff PII; which retention schedule applies; is Loogo Labs acting on the agency's behalf (and so bound by ch. 119 contract terms)? | Counsel |
| C9 | Legal basis for giving an HRSA, FTCA, or AHCA reviewer access to PHI in the product (health oversight disclosure, required by law, BAA) and the minimum necessary rules for each | Counsel; `security-privacy-officer` |
| C10 | Confirm the CY 2027 FTCA PAL: which plan needs board approval, and who affirms the application | HRSA official text |
