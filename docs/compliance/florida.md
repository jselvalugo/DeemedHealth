# Florida Operating Profile

Owners: `hrsa-regulatory-analyst` (program and Medicaid items) and
`security-privacy-officer` (privacy and breach items). Decision owner: the
product owner (@jselvalugo). See roadmap decisions D4 and D5.

**Deemed Health operates only in Florida.** Every customer health center, every
site on its Form 5B, and every pilot is in Florida. Serving a health center with
a site outside Florida needs a new roadmap decision and a state profile like this
one.

> These items are written from general knowledge. None is verified yet. Before an
> item becomes a catalog entry, a control, or contract language, verify it against
> the current Florida source. Record the statute or rule section, the URL, and the
> date you checked it, then change its status in the table to `verified`. Legal
> items go to counsel (roadmap decision D3).
>
> **Verification attempt, 2026-09-27 (`hrsa-regulatory-analyst` agent): not
> completed.** The session's network egress proxy blocked every official source
> (leg.state.fl.us, flsenate.gov, ahca.myflorida.com, flhealthsource.gov), so the
> text of §501.171 and §408.051 was not read. A web-search summary (not the
> statute) was consistent with the 30-day individual notice and the 500-person
> Department of Legal Affairs notice in FL-PRIV-1. That is not verification. The
> 1,000 consumer-reporting-agency threshold, the 10-day third-party agent
> deadline, and the §408.051 data-location text are unconfirmed. All items stay
> `draft` and all counsel items stay open.

## 1. What Florida-only means for the product

| Area | Effect |
| --- | --- |
| Tenancy | Organization and site addresses must be in Florida. Tenant provisioning rejects any other state until a new decision is made |
| Time zones | Florida has two: Eastern, and Central for the western Panhandle. Each site stores its own time zone. Due-date math and fixtures cover both (`qa-test-engineer`) |
| Language | English and Spanish from day one, as already planned. Whether to add Haitian Creole is an open question (§5) |
| State screening | One state Medicaid exclusion adapter: Florida's (AHCA). No other state adapters until another state is added |
| License verification | Florida Department of Health license lookup is the only state primary source for licensure |
| Catalog | State rules are catalog entries with source key `FL-*`. They are labeled as Florida requirements, never as HRSA requirements |
| Hosting | US regions only (ADR-0005). Every subprocessor that handles customer data, including the AI provider, processes it in the US (§3, item FL-PRIV-3) |

## 2. Florida sources to register in the catalog

| Key | Source | Used for | Status |
| --- | --- | --- | --- |
| `FL-FIPA` | Florida Information Protection Act, Fla. Stat. §501.171 | Breach notification, reasonable security measures, record disposal | draft |
| `FL-EHR-LOC` | Fla. Stat. §408.051 as amended in 2023, on where patient information in an electronic health record may be stored | Data-location limits for PHI | draft (applicability to a business associate needs counsel) |
| `FL-AHCA-SANC` | AHCA's list of sanctioned and terminated Florida Medicaid providers | State exclusion screening | draft |
| `FL-MEDICAID` | Florida Medicaid provider enrollment (AHCA) and Statewide Medicaid Managed Care (SMMC) plan credentialing | Enrollment module | draft |
| `FL-DOH-MQA` | Florida Department of Health, Division of Medical Quality Assurance, license verification | Licensure primary source verification | draft |
| `FL-456` | Fla. Stat. ch. 456 and the practice acts (for example ch. 458, 459, 464, 466) | License types, renewal cycles, and practitioner requirements | draft |
| `FL-435` | Fla. Stat. ch. 435 and §408.809 (Level 2 background screening, AHCA Clearinghouse) | Whether any health center staff need Level 2 screening. Likely out of scope for the MVP (§4) | draft |
| `FL-SUNSHINE` | Fla. Stat. ch. 119 (public records) and ch. 286 (open meetings) | Governance, for health centers that are public agencies or public-agency co-applicants | draft |

## 3. Privacy and breach items (for `security-privacy-officer` and counsel)

| # | Item | Planning assumption to verify |
| --- | --- | --- |
| FL-PRIV-1 | Breach notice timing under FIPA | Individuals are notified within 30 days. The Department of Legal Affairs is notified when 500 or more Floridians are affected. Consumer reporting agencies are notified above 1,000. A third-party agent (Loogo Labs' likely role) tells the covered entity within 10 days. Confirm how FIPA interacts with HIPAA notices |
| FL-PRIV-2 | FIPA's definition of personal information | Confirm which Deemed Health fields are covered (for example name plus license number, or medical information). Tag them in the data dictionary |
| FL-PRIV-3 | Data location (§408.051) | US-only hosting is assumed to satisfy it. Counsel confirms whether it binds a business associate, and whether it covers the AI provider and error-tracking vendors |
| FL-PRIV-4 | Florida Digital Bill of Rights (§501.701 and following) | Expected not to apply because of its revenue threshold. Counsel confirms |

The breach notification procedure (roadmap §7) must carry the stricter of the
HIPAA business associate deadline, the BAA deadline, and the FIPA third-party
agent deadline.

## 4. Program and Medicaid items (for `hrsa-regulatory-analyst`)

- **Exclusion screening:** screen against OIG LEIE, SAM.gov, and the AHCA
  sanctioned-provider list. Confirm whether the Florida Medicaid provider
  agreement or SMMC plan contracts require a set screening cadence. If one does,
  store it as an `FL-*` catalog entry.
- **Licensure:** list the Florida license types FQHC staff commonly hold
  (MD, DO, APRN, PA, RN, LPN, DDS, LCSW, LMHC, pharmacist) with their renewal
  cycles from `FL-456`, as catalog parameters.
- **Level 2 background screening:** decide whether it applies to FQHC staff.
  Results are highly sensitive. Store only the status and date, never the
  report, unless an ADR and a `security-privacy-officer` review say otherwise.
- **Sunshine Law:** for public-agency health centers, board meeting notice and
  public minutes rules sit on top of Compliance Manual Ch. 19. Model them as
  applicability on the organization.

## 5. Decisions (2026-09-27, owner @jselvalugo)

| # | Question | Decision |
| --- | --- | --- |
| FL-D1 | Languages | Follow language-access guidelines, with **English as the default**. The UI ships in English, with Spanish available as planned. Haitian Creole is not added to the staff-facing UI. Patient-facing outputs (grievance forms, survey text, notices) follow the language-access guidance that applies to the health center (HHS Section 1557 and Title VI limited-English-proficiency guidance, to verify), which the health center configures |
| FL-D2 | §330 recipient vs. Look-Alike | Unknown for the pilot. Build and verify applicability for **both** award types to the compliance standards. Neither type is blocked from the pilot, but a tenant's award type still cannot be provisioned until its catalog entries are verified |
| FL-D3 | Public agency or co-applicant | Unknown. Model it as an organization setting that onboarding asks about (default: not a public agency). When it is on, the `FL-SUNSHINE` items and the public-agency governance rules apply |
