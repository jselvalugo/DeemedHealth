# ADR-0009: Netlify for development environments

- Status: **Accepted**
- Date: 2026-09-27
- Decided by: product owner (@jselvalugo), 2026-09-27
- Owner: `platform-devops-engineer`
- Reviewers: `security-privacy-officer` (subprocessor entry), `suite-architect`
- Amends: **ADR-0005, for non-production only.** Production hosting is unchanged.
- Related: ADR-0001 (stack), ADR-0005 §4–§6 (environments, `DH_ENV`, secrets); roadmap §2 rule 1; `docs/security/subprocessors.md`

## Context

ADR-0005 places every environment in AWS (`dh-nonprod` for preview and staging,
`dh-prod` for production). The AWS organization, accounts, and IaC do not exist
yet, and Phase 0/1 work needs a place to show the web shell to reviewers now.
The product owner decided to develop on Netlify for now.

Netlify is not covered by a BAA for Deemed Health. That is acceptable only if it
never receives customer data, PHI, or PII, which ADR-0005 already requires of
every non-production environment (synthetic data only, forever).

## Decision

1. **Netlify hosts non-production only**: per-PR deploy previews, branch deploys,
   and the main-branch development/staging site of `apps/web`. Local development
   is unchanged.
2. **Production stays on AWS per ADR-0005** until a later ADR says otherwise.
   Nothing in this ADR changes production.
3. ADR-0005 §4 is amended so that `preview` and `staging` *may* run on Netlify
   instead of `dh-nonprod`. ADR-0005 §5 gains the `DH_ENV` value `development`
   for these Netlify deploys (`packages/domain/src/environment.ts`).

### Guardrails (all required)

- **`DH_ENV` is never `production` on Netlify.** `netlify.toml` sets
  `DH_ENV=development` for every context (`production`, `deploy-preview`,
  `branch-deploy`, `dev`). Netlify's context named "production" is only the
  main-branch deploy of the development site.
- **The build fails if `DH_ENV=production`** (or is missing):
  `scripts/assert-non-production.mjs` runs before the build, and
  `apps/web/next.config.ts` throws when `NETLIFY=true` and `DH_ENV=production`.
- **The PREVIEW banner is always on.** Because `DH_ENV` is never `production`,
  the amber banner from `docs/brand/design-system.md` §4 renders on every page.
- **No real integrations and no secrets beyond sandbox.** Screening sources,
  email, SMS, and AI use stubs or vendor sandboxes. Only sandbox credentials may
  be stored in Netlify environment variables, never production ones, and none
  with a `NEXT_PUBLIC_` prefix.
- **No customer data.** Synthetic data from `packages/test-fixtures` only.
  Production data is never copied to Netlify. No database on Netlify holds
  anything but synthetic seed data.
- **Deploy previews are password-protected** where the Netlify plan allows
  (Site settings, Access control, Password protection or Netlify SSO/team login).
  If the plan does not allow it, previews contain only public, synthetic content.
- **The site is noindexed**: `X-Robots-Tag: noindex, nofollow` on every response
  (`netlify.toml` headers and the Next.js security headers) plus `robots` metadata.
- Netlify is listed in `docs/security/subprocessors.md` as non-production only,
  no BAA, never PHI or PII.

## Alternatives considered

- **Wait for the AWS `dh-nonprod` account and IaC.** Keeps one platform, but
  blocks reviewable previews for weeks.
- **Vercel or Render for non-production.** Similar trade-offs; Netlify was the
  product owner's choice.
- **Also move production to Netlify.** Rejected for now: no BAA, weaker region
  and account-separation guarantees (ADR-0005 alternatives).

## Consequences

- Two hosting platforms until production and non-production converge; deploy
  scripts must keep the `DH_ENV` guard on both.
- Anything that needs a BAA-covered service (real Postgres with customer data,
  evidence storage, real integrations) cannot be exercised on Netlify.
- `apps/api` and `apps/worker` are not hosted on Netlify by this ADR; hosting for
  them in non-production needs a follow-up decision.
- Revisit when the AWS `dh-nonprod` account exists, or before G4.

## Status

Accepted by the product owner (@jselvalugo) on 2026-09-27. Amends ADR-0005 for
non-production only.
