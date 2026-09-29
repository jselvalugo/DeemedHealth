# @deemed/requirements-catalog

Owner: `hrsa-regulatory-analyst`. The versioned HRSA (and Florida) requirements
catalog: requirements are data, not code (CLAUDE.md principle 4).

- `src/schema.ts` — zod schemas for catalog entries (`CatalogEntrySchema`),
  sources (`SourceSchema`, `SourceRegisterSchema`), and health-center N/A records
  (`NotApplicableRecord`), plus `productionEntries()`.
- `src/conventions.ts` — the typed meaning of `cadence.trigger` and of the well-known
  `parameters` keys (`cadenceBasis`, `approval`, `tenantParameters`), plus
  `checkEntryConventions()` (labeling, applicability, cadence rules) and
  `checkTenantParameterValue()`.
- `sources/sources.yaml` — the source register (framework §1, florida.md §2).
- `entries/<requirementId>.yaml` — one entry per file (ADR-0003 §1).
- Entry shape is documented in `docs/compliance/hrsa-requirements-framework.md` §4.

## Rules
- **Verified only in production** (roadmap §2 rule 6). Use `productionEntries(entries, asOf?)`
  for anything a production tenant sees. `draft` entries stay in non-production and the review queue.
- `status: verified` requires every source to carry `url`, `verifiedOn`, and `verifiedBy`.
  Never verify from memory.
- Applicability: `awardTypes` (section330 | lookalike), `subPrograms` (CHC, MHC, HCH, PHPC),
  `siteTypes`, `staffTypes`, `jurisdiction`. An omitted list means "all".
- `notApplicable: { allowed: true, reason }` only where the manual allows N/A; each
  health center's N/A decision also requires its own reason.
- `layer` separates HRSA `requirement`, `best_practice`, Florida `state_requirement`, and
  `payer_rule` (a CMS or Medicaid rule, shown as such and never as an HRSA requirement).
- Dates are real `YYYY-MM-DD` calendar dates; `effective.to >= effective.from`;
  `retired` requires `effective.to`.

## Rule shapes (how an entry expresses each one)

| Shape | How | Example |
| --- | --- | --- |
| Expiration with lead days | `cadence.trigger: on_expiration` or `on_hire_and_expiration`, `renewalMonths: null`, non-empty `leadDays`. Due date = expiration date on the evidence | `CM-05-CRED-LIP-LICENSURE` |
| Periodic | `cadence.trigger: periodic`, `renewalMonths` (or one tenant parameter that `drives` it), non-empty `leadDays`, `parameters.cadenceBasis: since_last_completion \| calendar_period` | `CM-19-BOARD-MONTHLY-MEETINGS` |
| One-time document | `cadence: null`, or `on_change` (re-opened when the fact changes; empty `leadDays`) | `CM-05-CP-PROCEDURES` |
| Board-approval-backed | `parameters.approval: { approvalTypeId, requiredCapacity: board \| board_or_committee_ratified \| designated }` (approval-authority.md §4.1) | `CM-19-BUDGET-ANNUAL` |
| Tenant parameter with bounds | `parameters.tenantParameters.<name>: { type: integer, unit, min, max, default, drives, guidance }` | `CM-05-PRIV-RENEWAL` |
| Not applicable allowed | `notApplicable: { allowed: true, reason }` | `CM-05-CRED-LIP-DEA` |

Other `parameters` keys (thresholds such as `minMembers`) stay free-form.
ID prefixes: `CM-`/other federal keys for HRSA requirements, `FL-` for Florida
state rules (`layer: state_requirement`, FL-* sources only, `chapter: null`),
`BP-` for best practice (`layer: best_practice`), `CMS-`/`MCD-` for Medicare and
Medicaid rules (`layer: payer_rule`, citing at least one `CMS-*`, `MCD-*`, or `PL-*` source).

## Status
All sources are `draft`: none have been fetched and checked yet. The entries in
`entries/` are **drafts** written 2026-09-29 without access to the official
sources (the network proxy blocked them). None is verified, so the production
bundle is empty (`describeProductionBundle()` says so). The three `CMS-`/`MCD-`
entries are the payer rules in CLAUDE.md rows R1–R3.

## Build and publish (ADR-0003 rules 3, 8, 11)
`@deemed/requirements-catalog/compiler` (Node only) holds the compiler, the file loader,
and canonical hashing.

```sh
pnpm --filter @deemed/requirements-catalog build:catalog -- --version 2026.1.0 \
  [--previous-dir <last published bundles>] [--out dist/bundles]
```

`compileCatalog()` validates every entry (schema, `checkEntryConventions()`, registered
sources, verified entries citing only verified sources, supersession chains, and, against
the previous release, stable ids and an increasing version), then writes two bundles:
`catalog.non-production.json` (every entry, drafts badged) and `catalog.production.json`
(verified entries only). It prints `describeProductionBundle().message`, so an empty
production bundle is always called out. Bundles carry no build time: the same sources and
version give byte-identical bundles and content hashes.

The publish job (`runCatalogPublishJob` in `@deemed/readiness/service`, as
`app_platform`) loads the bundle matching the database's channel into the global
`catalog.*` tables (migration 0010). A production database refuses any non-verified entry
three times over: the job, `catalog.publish_release`, and the table constraint
`requirement_version_production_verified`. Released versions are immutable.

## Tests
`pnpm --filter @deemed/requirements-catalog test` (vitest).
