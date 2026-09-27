# @deemed/requirements-catalog

Owner: `hrsa-regulatory-analyst`. The versioned HRSA (and Florida) requirements
catalog: requirements are data, not code (CLAUDE.md principle 4).

- `src/schema.ts` — zod schemas for catalog entries (`CatalogEntrySchema`),
  sources (`SourceSchema`, `SourceRegisterSchema`), and health-center N/A records
  (`NotApplicableRecord`), plus `productionEntries()`.
- `sources/sources.yaml` — the source register (framework §1, florida.md §2).
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
- `layer` separates HRSA `requirement`, `best_practice`, and Florida `state_requirement`.
- Dates are real `YYYY-MM-DD` calendar dates; `effective.to >= effective.from`;
  `retired` requires `effective.to`.

## Status
All sources are `draft`: none have been fetched and checked yet. There are no
catalog entries yet.

## Tests
`pnpm --filter @deemed/requirements-catalog test` (vitest).
