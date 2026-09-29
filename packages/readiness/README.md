# @deemed/readiness

The readiness engine (G1-8) and its database service. Phase-1 plan S4; ADR-0003 rules
3, 4, 5, 7, 8.

- `@deemed/readiness`: the **engine**. `evaluate(input)` is a pure function of the
  catalog entry, the tenant's parameters, the evidence facts, the as-of instant, and the
  site's time zone. No I/O, clock, or randomness (an ESLint rule enforces it). All date
  math goes through `@deemed/dates` in the site's zone. `buildSnapshot()` summarizes
  results pinned to a `catalogVersion`.
- `@deemed/readiness/service`: the **database side**. The catalog publish job
  (`runCatalogPublishJob`, app_platform), the recompute job (`recomputeTenant`,
  `recomputeHandler`, `enqueueRecompute`, `enqueueNightlySweep`), and the audited
  mutations (`markNotApplicable`, `clearNotApplicable`, `setTenantParameter`,
  `recordFact`, `retractFact`).

Every status is **internal readiness, never an HRSA determination**. Each result carries
`internalOnly: true`, the citation (requirementId, sources, last verified), and a summary
that ends with the label ("Florida requirement. ... not a determination by HRSA or the
State of Florida" for FL- entries).

## Status vocabulary

Stored in `requirement_instance.status`; mapped to the framework's section 6 terms:

| Status | Framework term | When |
| --- | --- | --- |
| `met` | Met | Evidence of a listed type satisfies the rule and the due date is more than `atRiskDays` away |
| `due_soon` | At risk | Within `cadence.atRiskDays` (default 30, capped at the largest lead day), or due / expiring today (on time until local midnight); or met but carrying a superseded N/A mark |
| `overdue` | Not met | Expired, past due, or a whole calendar period with nothing on file |
| `missing` | Not met | No qualifying evidence at all |
| `not_applicable` | Not applicable | A person marked it, with a reason, and the catalog allows N/A |
| `not_assessed` | Not assessed | Not evaluated: no release, not in the release, draft entry in production, retired, not in effect, outside `appliesTo`, a required tenant parameter unset or out of bounds, or a parameter the engine does not evaluate (`threshold_not_evaluated`) |

The framework's copy of this table and the score rule live in
`docs/compliance/hrsa-requirements-framework.md` section 6.

**Known approximation (F10).** CM-19-BUDGET-ANNUAL is due 12 months after the last
board approval. The real due point is "before the budget period starts", which
differs by health center. TODO: add a tenant parameter for the budget period start
(month and day) and anchor the entry on it as a calendar period. The entry stays
draft either way.

## Rules (in order; the first that applies decides)

1. Production channel and the entry is not `verified`: `not_assessed` (fail closed).
2. Entry `retired`: `not_assessed`.
3. Not in effect on the as-of date (site calendar): `not_assessed`.
4. Outside `appliesTo` (award type, sub-programs, site type, staff type): `not_assessed`.
   Staff types are not stored yet (provider profiles come later), so for person subjects
   that dimension is not checked; the instance's existence is the decision.
5. Marked N/A by a person, recorded by the as-of instant, and `notApplicable.allowed`:
   `not_applicable`. A mark the catalog does not allow is ignored (reason
   `not_applicable_not_allowed`) and cleared, with an audit event, by the recompute job.
6. The rule shape, read from the catalog conventions (`requirements-catalog/src/conventions.ts`):
   - **Expiration** (`on_expiration`, `on_hire_and_expiration`): the latest `expiresOn` on
     file. Overdue from local midnight after it; `due_soon` from the largest lead day
     through the day itself; `leadTier` is the most urgent lead day reached.
   - **Periodic, since last completion**: due = last completion + N months (month-end
     clamped, `nextDueFromLastVerification`). N is `renewalMonths`, or the tenant parameter
     that `drives` it (its value, else its default; unset with no default or out of bounds
     is `not_assessed`, never a guess).
   - **Periodic, calendar period**: at least one completion in each calendar period of N
     months. This period done: `met`, next due the end of the next period. Last period
     done, this one open: due the end of this period (lead days apply). Last period
     missed: `overdue`.
   - **One-time** (`cadence: null`): `met` once a document or completion is on file.
   - **On change**: like one-time, but a `change` fact dated after the evidence reopens it.
   - **Board-approval-backed** (`parameters.approval`): only approvals count, of the
     named `approvalTypeId` (a `*` segment matches any segment) and in a satisfying
     capacity: `board` needs `board`; `board_or_committee_ratified` accepts `board` or
     `committee_ratified`; `designated` accepts those or `designated`. `staff` never
     satisfies. Rejections do not count.

Facts are ignored when recorded after the as-of instant, retracted by then, or dated
after the as-of date, so "as of" results are reproducible. Fact order never matters.

## Jobs

`readiness.recompute` is enqueued with `sendJob` inside the transaction of each change
(singleton per tenant, so bursts coalesce), for every tenant when a catalog release is
published, and by the nightly sweep (which also stores the day's snapshot, unique per
tenant, release, date, and kind). The recompute writes only what changed, one
`requirement_instance.evaluate` audit event per change, and `catalog_release.applied`
the first time a tenant is evaluated under a release. Running it twice changes nothing.

## Tests

- `src/*.test.ts` (unit): rule shapes, Eastern and Central zones, DST days, month ends,
  the 2028 leap day, gates, labels, the draft catalog; property-based determinism
  (fast-check); snapshot tests (`__snapshots__`); EN/ES string parity.
- `test/*.test.ts` (db project, PostgreSQL 16): publish job and the production
  constraint; recompute end to end through `drain()`, audit, human-only N/A and
  parameters, tenant isolation, snapshots pinned to `catalogVersion`.
