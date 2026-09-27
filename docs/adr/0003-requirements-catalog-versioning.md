# ADR-0003: Requirements catalog versioning

- Status: **Proposed** (only the product owner, @jselvalugo, accepts; roadmap D5)
- Date: 2026-09-27
- Owner: `suite-architect`; content owner `hrsa-regulatory-analyst`
- Related: ADR-0001, ADR-0002; `docs/compliance/hrsa-requirements-framework.md` §1, §4–§6; `docs/compliance/florida.md`; roadmap §2 rule 6, decisions D4, FL-D2, FL-D3

## Context

Principle 4: requirements are data, not code. Every rule a module enforces
cites a `requirementId`. HRSA changes policy through PALs/PINs and manual
revisions with effective dates; readiness snapshots must stay explainable under
the version they were computed with. Applicability differs by award type
(§330 recipient vs. Look-Alike), sub-program (CHC, MHC, HCH, PHPC), site type,
staff type, and organization settings such as public-agency status (FL-D3).
Deemed Health operates only in Florida (D4), so Florida state rules must be in
the catalog, but must never be labeled as HRSA requirements. All catalog items
are currently unverified drafts; the roadmap requires that only verified
entries reach production tenants.

## Decision

1. **Source of truth is Git.** Entries are YAML files in
   `packages/requirements-catalog/entries/`, one per `requirementId`, with the
   shape in framework §4. Sources are registered in
   `packages/requirements-catalog/sources/` (key, title, version, URL,
   effective date, `verifiedOn`, `verifiedBy`). Changes go through PRs that
   require `hrsa-regulatory-analyst` review (CODEOWNERS).
2. **Identifiers are stable.** A `requirementId` is never reused or renamed. A
   substantive change creates a new entry that `supersedes` the old one; the
   old one gets `effective.to` and `status: retired`.
3. **Catalog releases.** A publish creates an immutable, semver'd
   `CatalogVersion` (e.g. `2026.1.0`) with a content hash and a changeset list
   (`added | changed | retired` per `requirementId`, linked to the PAL/PIN or
   source revision). Releases are loaded into global, read-only tables
   (ADR-0002). Released versions are never edited.
4. **Temporal validity.** Each entry has `effective.from/to`. The readiness
   engine selects entries effective on the evaluation date. Each
   `RequirementInstance` and each readiness snapshot records the
   `catalogVersion` and entry revision it was computed under; past snapshots
   are never recomputed silently.
5. **Applicability is declarative.** `appliesTo` supports:
   - `awardTypes: [section330, lookAlike]` (required on every entry; both are
     built and verified per FL-D2),
   - `subPrograms: [CHC, MHC, HCH, PHPC]`,
   - `siteTypes`, `staffTypes` (e.g. LIP, OLCP), `roles` (board member, contractor),
   - `orgFlags` (e.g. `publicAgency` for `FL-SUNSHINE` items),
   - `jurisdiction: US | FL`.
   A tenant may mark an instance **Not applicable** only with a required reason,
   the actor, and a date; it is audited and never deletes the instance.
6. **Florida sources.** State rules use source keys `FL-*` (`FL-FIPA`,
   `FL-EHR-LOC`, `FL-AHCA-SANC`, `FL-MEDICAID`, `FL-DOH-MQA`, `FL-456`,
   `FL-435`, `FL-SUNSHINE`) and IDs prefixed `FL-` (e.g.
   `FL-456-LICENSE-RENEWAL-RN`). Entries carry `jurisdiction: FL` and
   `authority: state`; the UI labels them "Florida requirement", never "HRSA".
   Program entries carry `authority: federal`. Mixed obligations (e.g. HRSA
   screening plus the AHCA list) are separate entries linked by `relatedTo`.
7. **Parameters live in the catalog.** Intervals, thresholds, lead days,
   severity weights, and license renewal cycles are catalog parameters. Where
   the source allows a health-center choice (e.g. re-privileging interval),
   the entry declares a `tenantParameter` with bounds and guidance; the tenant
   value lives in tenant tables and is audited. Module code holds no constants
   (lint check for known parameter names).
8. **Verified-only in production.** Entry `status` is `draft | verified |
   retired`. `verified` requires every source citation to have `url`,
   `locator`, `verifiedOn`, `verifiedBy`, and a registered source that is
   itself verified. The build produces two artifacts:
   - a **non-production** bundle (all statuses, draft visibly badged), and
   - a **production** bundle that **excludes every `draft` entry**. The
     publish job refuses to load a draft into a production database, and a
     DB constraint on the production catalog tables rejects `status <> 'verified'`
     (retired entries are kept for history but not evaluated).
   Drafts never appear in customer UI, exports, readiness, or AI answers.
   A tenant's award type cannot be provisioned in production until the entries
   applying to it are verified (FL-D2).
9. **Re-verification.** Each source has a review interval; a stale
   `verifiedOn` creates an analyst task. The UI shows "last verified" per
   requirement (principle 3).
10. **Policy updates** follow framework §5: changeset → impact estimate by
    `suite-architect` → migration of affected instances → Command Center
    "Policy updates" page.
11. **Validation in CI.** A compiler validates schema, unique/stable IDs,
    supersession chains, effective-date overlaps, applicability completeness
    (`awardTypes` present), `FL-*` labeling rules, and parameter bounds.

## Alternatives considered

- **Catalog in a database edited via an admin UI.** Easier for non-developers,
  but weaker review, diff, and provenance. Git + PR review keeps the analyst
  sign-off visible; an editor UI can be added later that writes PRs.
- **Rules as code per module.** Contradicts principle 4 and duplicates the
  readiness engine.
- **Single mutable catalog without versions.** Makes past readiness
  unexplainable after a policy change.
- **Feature flag for drafts instead of separate bundles.** A flag can be
  misconfigured; physically excluding drafts from the production artifact and
  constraining the DB fails closed.

## Consequences

- Until the analyst verifies entries, production has little or no catalog
  content; this is intentional and blocks G4/G5 for affected award types.
- Every module feature depends on catalog IDs existing first (at least as
  drafts in non-production).
- Readiness history is reproducible by `catalogVersion`.
- Adding a state later means new `jurisdiction` values and a new source prefix,
  handled without schema changes.

## Status

Proposed. Awaiting acceptance by the product owner (@jselvalugo).
