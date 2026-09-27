# Fixture Plan: `packages/test-fixtures`

Owner: `qa-test-engineer`. Consumers: unit, integration, contract, and E2E suites.

## 1. Rules for every fixture

- **Synthetic only.** No real person, organization, NPI, license, or address.
  "XYZ Community Health Center" is fictional.
- **No SSNs.** No field named or shaped like an SSN (`\d{3}-?\d{2}-?\d{4}` in an
  identifier position). The CI SSN scan (G1) runs over this package.
- **NPIs** come only from `makeTestNpi(seed, entityType)` in `src/npi.ts`: 10 digits,
  Luhn check digit computed with the `80840` prefix, returned as
  `{ value, test: true, source: 'synthetic' }`. Seeds are fixed per fixture so values
  are stable. Raw NPI strings are not hand-typed in fixtures.
- **Every record carries `test: true`**, which the G4 non-production data scan and
  production import guard use.
- DOBs and DEA-shaped values are fake and are also the log-hygiene canaries (G1).
- Dates are stored as UTC instants plus the site's IANA zone; each fixture states
  the fixed "now" it is evaluated at.
- One fixture exercises one edge. Each has an ID, the `requirementId`s it touches,
  and the expected outcome as data, so tests assert against the fixture, not
  against re-derived logic.

## 2. Base organization: XYZ Community Health Center (FX-ORG-XYZ)

| Field | Value |
| --- | --- |
| State | FL (provisioning rejects any other state) |
| Org NPI | `makeTestNpi(1, 2)` |
| Default time zone | `America/New_York` |
| Languages | EN default, ES enabled |

| Site | City (fictional address) | Time zone |
| --- | --- | --- |
| XYZ-S1 Main | Orlando area | `America/New_York` |
| XYZ-S2 East | Jacksonville area | `America/New_York` |
| XYZ-S3 Panhandle | Pensacola area (western Panhandle) | `America/Chicago` |

### Variants

| ID | Variant | Edge exercised | Expected |
| --- | --- | --- | --- |
| FX-ORG-330 | §330 recipient (330(e)) | Baseline applicability | FTCA module applicable |
| FX-ORG-LAL | Look-Alike | Applicability; FL-D2 | FTCA module Not applicable; provisioning blocked while Look-Alike catalog entries are `draft` |
| FX-ORG-PUB | Public-agency co-applicant (FL-D3 on) | `FL-SUNSHINE` and public-agency governance rules | Sunshine items applicable; off in the other variants (default not a public agency) |
| FX-ORG-SPECPOP | Funded only under §330(g)/(h)/(i) with patient-majority waiver | Ch. 20 waiver | Patient-majority requirement waived, other composition rules still apply |
| FX-ORG-OOS | Site with a Georgia address | Florida-only tenancy | Provisioning rejected |

## 3. Board composition (FX-BOARD-*)

Composition parameters come from the catalog, not constants in tests.

| ID | Board | Expected |
| --- | --- | --- |
| FX-BOARD-51 | Smallest-margin majority: 9 members with 5 patients (55.6%) and 25 with 13 (52%). Exactly 51% is impossible on a 9–25 member board, so the rule is tested as "more than 50%" with these closest cases plus a unit test of the ratio function at 0.51 | Majority met |
| FX-BOARD-50 | 10 members, 5 patients (exactly 50%) | Majority not met (must be over 50%) |
| FX-BOARD-8 | 8 members | Below minimum of 9: not met |
| FX-BOARD-25 | 25 members | Upper bound met; 26 not met |
| FX-BOARD-INCOME | Non-patient members with more than the allowed share deriving over 10% of income from the health care industry | Not met |
| FX-BOARD-WAIVER | Uses FX-ORG-SPECPOP | Patient majority waived and shown as waived, not as met |

## 4. Dates and expirations (FX-DATE-*)

| ID | Case | Expected |
| --- | --- | --- |
| FX-DATE-FEB29 | FL license expires 2028-02-29 (leap day); evaluated in 2028 and a 1-year cadence rolling into 2029 | Renewal due 2029-02-28; 30/60/90-day warnings on correct days |
| FX-DATE-MONTHEND | License expires Jan 31; monthly cadence | Next dates Feb 28/29, Mar 31 (no drift to the 28th) |
| FX-DATE-TZ-E | Expiration at end of day at XYZ-S1 (`America/New_York`) | Expired from 00:00 ET next day (04:00 or 05:00 UTC by DST) |
| FX-DATE-TZ-C | Same date at XYZ-S3 (`America/Chicago`) | Expired one hour later in UTC than FX-DATE-TZ-E; evaluated at 23:30 CT the day it is still valid |
| FX-DATE-DST | Due date on DST start and end Sundays | No off-by-one day in either zone |

## 5. Providers (FX-PROV-*)

| ID | Case | Expected |
| --- | --- | --- |
| FX-PROV-PRIV | Provider privileged at XYZ-S1 and XYZ-S2, not S3 | Cleared at S1/S2; not cleared at S3 |
| FX-PROV-BLS | BLS lapsed yesterday | Not cleared; expiration task open |
| FX-PROV-FEB29 | Provider linked to FX-DATE-FEB29 license | Readiness follows date rules |
| FX-PROV-MULTI | Provider at both an Eastern and Central site | Each site's deadline computed in that site's zone |

## 6. Screening (FX-SCR-*)

Recorded source files (LEIE, SAM.gov, AHCA sanctioned list) are synthetic and
carry a file hash and retrieval time.

| ID | Case | Expected |
| --- | --- | --- |
| FX-SCR-OIG-HOMONYM | Staff name matches an LEIE row; DOB differs; no NPI match | Possible match, needs human decision; cleared with reason; audited. Never auto-cleared |
| FX-SCR-TRUE | Name, DOB, and NPI match | Match; not clear |
| FX-SCR-FAIL | Source download fails | Run shows failed, never "clear" |
| FX-SCR-AHCA | Match only on the AHCA list | Flagged under `FL-AHCA-SANC`, labeled as a Florida requirement |

## 7. Catalog changesets (FX-CAT-*)

| ID | Case | Expected |
| --- | --- | --- |
| FX-CAT-CHANGE | Changeset v2 retires requirement A and changes B's cadence | New snapshots use v2; A no longer scored |
| FX-CAT-SNAPSHOT | Snapshot taken under v1 before the changeset | Keeps catalog v1 and its original status |

## 8. Regression fixtures (FX-REG-*)

Every pilot readiness error (sev-1) gets a fixture named `FX-REG-<defect id>`
reproducing it (G5).

## 9. Package layout

```
packages/test-fixtures/
  package.json          @deemed/test-fixtures
  src/npi.ts            Luhn NPI generator and validator (done)
  src/npi.test.ts
  src/orgs/             FX-ORG-*
  src/boards/           FX-BOARD-*
  src/dates/            FX-DATE-*
  src/providers/        FX-PROV-*
  src/screening/        FX-SCR-* plus recorded source files
  src/catalog/          FX-CAT-*
```

Phase 0 ships only `npi.ts`. The other folders are built in Phase 1 alongside the
domain types they depend on.
