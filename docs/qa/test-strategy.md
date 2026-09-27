# Test Strategy

Owner: `qa-test-engineer`. Source of the gates: `docs/product/implementation-roadmap.md`
(G1–G5). Fixtures: `docs/qa/fixture-plan.md` and `packages/test-fixtures`.

A wrong "Compliant" badge or a missed expiration is a real compliance failure for a
health center. Tests exist to prevent both.

## 1. Test types and tools

| Type | Tool | Runs | Scope |
| --- | --- | --- | --- |
| Unit | Vitest | Every PR | `packages/domain`: readiness engine, cadence/due-date math, board composition, applicability, screening match scoring, permission policies |
| Integration | Vitest + Testcontainers (Postgres, RLS on) + MinIO | Every PR | API endpoints, RLS, audit events, storage behavior |
| Contract | Vitest + recorded fixtures | Every PR | Integration adapters (LEIE, SAM.gov, AHCA, NPPES, FL DOH MQA). No live calls in CI |
| Configuration | Vitest / policy-as-code (Checkov or OPA) against IaC | Every PR touching infra; nightly on deployed env | Encryption, KMS rotation, bucket policies, TLS/headers |
| Static checks | Custom CI scripts, ESLint rules | Every PR | SSN-shaped values, schema field names, forbidden wording, hex colors |
| E2E | Playwright (EN and ES) | Preview deploy | Critical journeys 1–7 |
| Accessibility | axe-core (Playwright + Storybook test runner); manual scripts | Every PR; manual per release | WCAG 2.1 AA |
| Visual | Playwright screenshots | Every PR | Shell, launcher, KPI tiles, status badges |
| AI evals | Golden sets in CI (with `ai-assistant-engineer`) | Phase 6 onward | Accuracy, citations, refusals, leakage, injection |
| External / manual | Pen test, restore test, tabletop, scans | Per gate | G4 operational evidence |

## 2. Gate mapping

Owner is the agent accountable for the test existing and passing; QA reviews all.
"Evidence" items are not automated tests; QA verifies the recorded artifact.

### G1 · Platform-secure

| Checkbox | Test type | Owner | Tool |
| --- | --- | --- | --- |
| Tenant isolation (DB and API, every table/endpoint) | Integration; generated per-table and per-endpoint matrix, fails on any unlisted table | `data-architect`, `backend-engineer` | Vitest + Testcontainers (RLS on, non-superuser role) |
| Authorization (allowed, denied, other-site, other-tenant per endpoint) | Integration; route manifest check fails if an endpoint lacks the four cases | `backend-engineer`, `security-privacy-officer` | Vitest + Testcontainers |
| Audit (event per mutation/reveal/export/approval/login/permission change; hash chain; no UPDATE/DELETE grant) | Integration + DB privilege test | `data-architect` | Vitest + Testcontainers (`has_table_privilege`) |
| Identity (MFA mandatory, session expiry, re-auth, SCIM revokes sessions) | Integration with fake clock; E2E for re-auth prompt | `backend-engineer` | Vitest, Playwright, mock OIDC IdP |
| Uploads (EICAR rejected, spoofed type rejected, URL expiry) | Integration | `backend-engineer` | Vitest + Testcontainers (ClamAV, MinIO), fake clock |
| Logging hygiene (seeded fake DOB/DEA never in logs, traces, errors) | Integration with log/trace/error sinks captured | `security-privacy-officer`, `backend-engineer` | Vitest, in-memory OTel exporter |
| No SSN (no field; importer rejects; CI scan of fixtures/seed) | Static check + integration (importer) | `security-privacy-officer`, `qa-test-engineer` | CI script over schemas/fixtures, Vitest |
| Readiness engine (determinism, leap year, month end, time zones, snapshot catalog version) | Unit (property-based for determinism) | `backend-engineer`, `qa-test-engineer` | Vitest + fast-check, fixtures FX-DATE-*, FX-CAT-* |
| Encryption (DB, storage, backups on KMS; rotation on) | Configuration | `platform-devops-engineer`, `security-privacy-officer` | Policy-as-code on IaC |
| Storage (public access blocked, versioned, legal hold blocks delete) | Configuration + integration | `platform-devops-engineer`, `data-architect` | Policy-as-code; Vitest + MinIO object lock |
| Roles (auditor role expires; record-level denied paths) | Unit (policy) + integration | `backend-engineer` | Vitest, fake clock |
| Customer audit access (view/export own log; tampered row fails verification) | Integration + E2E | `data-architect`, `frontend-engineer` | Vitest, Playwright |
| Environments (PREVIEW banner in non-prod) | E2E + visual | `design-system-engineer` | Playwright |
| Accessibility (axe on shell/launcher; keyboard and SR scripts) | Accessibility automated + manual | `design-system-engineer`, `qa-test-engineer` | axe-core; NVDA/VoiceOver scripts |
| Internal security review and threat model | Evidence | `security-privacy-officer` | Review record in PR |

### G2 · Feature-complete MVP

| Checkbox | Test type | Owner | Tool |
| --- | --- | --- | --- |
| Every MVP page meets DoD (EN/ES, four states) | E2E + visual per state; i18n key-parity check | `frontend-engineer`, `ux-content-writer` | Playwright, Storybook stories per state, CI key diff |
| Regulatory review per module; catalog entries `verified` | Evidence + static check (no `draft` entry referenced by an MVP module) | `hrsa-regulatory-analyst` | CI catalog lint |
| Security review per module | Evidence | `security-privacy-officer` | Review record |
| Contract tests on recorded fixtures only; ToU reviewed | Contract; network egress blocked in CI | `integrations-engineer` | Vitest + recorded fixtures, nock `disableNetConnect` |
| E2E journeys 1, 3, 4, 6, 7 in EN and ES | E2E | `qa-test-engineer` | Playwright on preview deploy |
| Coverage thresholds | Coverage gate | `qa-test-engineer` | Vitest v8 coverage |
| Applicability §330 vs. Look-Alike; Look-Alike provisioning blocked until verified | Unit + integration | `hrsa-regulatory-analyst`, `backend-engineer` | Vitest, fixtures FX-ORG-330 / FX-ORG-LAL |
| EN/ES copy audit for determination wording | Static check + manual audit | `ux-content-writer` | CI denylist scan over string catalogs |
| Each integration run writes an audit event | Integration | `integrations-engineer` | Vitest + Testcontainers |
| Log hygiene with new fields; risk analysis reviewed | Integration + evidence | `security-privacy-officer` | Same harness as G1 |

### G3 · Restricted-data-ready

| Checkbox | Test type | Owner | Tool |
| --- | --- | --- | --- |
| Restricted fields encrypted, masked, reveal-audited, excluded from search/logs/notifications/exports/analytics | Integration (each sink asserted) | `data-architect`, `security-privacy-officer` | Vitest + Testcontainers |
| Only QI/Risk, Compliance officer, authorized executives read narratives | Integration role matrix (allowed and denied) | `backend-engineer` | Vitest |
| Retention/deletion with legal hold | Integration with fake clock | `data-architect` | Vitest |
| No deeming application, claim, or suit notice transmitted | Integration; outbound transport spies assert zero calls; static check for submission endpoints | `ftca-risk-quality-specialist`, `backend-engineer` | Vitest, egress-blocked CI |
| Log hygiene with restricted fields | Integration | `security-privacy-officer` | Same harness as G1 |
| Risk analysis and verdicts | Evidence | `hrsa-regulatory-analyst`, `security-privacy-officer` | Review records |

### G4 · Ready to operate (internal)

| Checkbox | Test type | Owner | Tool |
| --- | --- | --- | --- |
| Pen test: no open critical/high | External | `security-privacy-officer` | Third-party report + retest |
| Restore test within RPO/RTO | Operational test | `platform-devops-engineer` | Scripted restore into isolated account, timed |
| Incident response tabletop | Exercise | `security-privacy-officer` | Tabletop record |
| Subprocessor BAAs; customer BAA/terms approved | Evidence | `security-privacy-officer` | `docs/security/subprocessors.md` |
| TLS 1.2+, HSTS, CSP, WAF | Scan | `platform-devops-engineer` | testssl.sh, header scan, ZAP baseline |
| JIT, MFA, logged prod access; access review | Configuration + evidence | `platform-devops-engineer` | Policy-as-code, review record |
| Training current; sanctions policy | Evidence | `security-privacy-officer` | Records |
| Support access time-boxed, approved, audited | Integration + E2E | `backend-engineer` | Vitest with fake clock, Playwright |
| Offboarding export and deletion rehearsed | Operational test on synthetic tenant | `data-architect` | Scripted rehearsal, deletion certificate |
| Retention schedule per data class; HIPAA docs 6 years | Integration + configuration | `data-architect` | Vitest, lifecycle policy check |
| No production data in non-prod | Scan | `security-privacy-officer` | Scanner using test-flag markers (all fixtures carry `test: true`, NPIs from `makeTestNpi`) |
| Florida counsel memo; strictest breach deadline | Evidence + unit test on deadline selector | `security-privacy-officer` | Vitest (min of HIPAA, BAA, FIPA agent deadlines) |
| Catalog re-verified within 60 days; no `draft` entries | Static check | `hrsa-regulatory-analyst` | CI catalog lint with verification-date check |
| Risk analysis signed | Evidence | `security-privacy-officer` | Record |
| Monitoring, on-call, patch SLAs | Operational test (synthetic alert fires and pages) | `platform-devops-engineer` | Alert drill |
| Go/no-go decision | Evidence | `suite-architect` | Signed record |

### G5 · General availability

| Checkbox | Test type | Owner | Tool |
| --- | --- | --- | --- |
| No open sev-1; every pilot readiness error has a regression test | Regression fixtures in `packages/test-fixtures` (FX-REG-*) linked to defect IDs | `qa-test-engineer` | Vitest; CI check that each sev-1 ID has a fixture |
| Pilot confirms statuses matched for a screening and an expiration cycle | Acceptance (customer-signed) | `qa-test-engineer`, `enrollment-screening-specialist`, `credentialing-privileging-specialist` | Reconciliation report |
| SOC 2 Type I issued | Evidence | `security-privacy-officer` | Report |
| Pricing, contract, onboarding reviewed by counsel | Evidence | `suite-architect` | Record |
| Log hygiene; risk analysis reviewed | Integration + evidence | `security-privacy-officer` | Same harness as G1 |

## 3. Critical E2E journeys (Playwright, EN and ES)

1. Launcher (Ctrl K) to Expirations, renew a license, readiness updates.
2. Onboard via Self-Service, credential and privilege, provider cleared.
3. Monthly screening, review possible match (FX-SCR-OIG-HOMONYM), decide, audit trail.
4. Board agenda from due actions, minutes, budget approval, Ch. 19 requirement Met.
5. Contract upload, required-provisions check, link to Form 5A service.
6. Site-visit binder export, audited and watermarked.
7. User without permission sees neither the launcher entry nor the API data.

G2 requires 1, 3, 4, 6, 7; journeys 2 and 5 are required when their modules ship.

## 4. CI quality thresholds

| Gate | Threshold |
| --- | --- |
| Type check | `tsc --noEmit` clean, strict mode |
| Lint | Zero errors |
| Unit and integration | 100% pass |
| Coverage | `packages/domain` at least 90% (lines and branches); overall at least 80% |
| Accessibility | Zero axe violations (any impact level) |
| E2E | All required journeys pass on the preview deploy, EN and ES |
| Visual | No unapproved snapshot diffs |
| Contract | Pass with network egress blocked |
| Static checks | Zero SSN-shaped values, zero determination wording, zero hex colors in components, zero `draft` catalog entries in a release |
| AI evals | At or above each golden-set threshold (Phase 6) |

## 5. Rules

- **No skipping and no quarantining.** `it.skip`, `describe.skip`, `test.fixme`,
  `.only`, retries added to hide flakiness, and moving a test out of the required
  suite are not allowed to get a build green. A lint rule and a CI grep fail the
  build on them. A failing or flaky test is fixed at its root cause.
- **No arbitrary waits.** Playwright uses web-first assertions; no `waitForTimeout`.
- **Time is injected.** All date logic takes a clock; tests use fixed instants and
  explicit IANA zones (`America/New_York`, `America/Chicago`). CI runs the unit
  suite under `TZ=UTC` and `TZ=Pacific/Kiritimati` to catch host-zone leaks.
- **Synthetic data only.** No SSNs anywhere; NPIs come from `makeTestNpi` and are
  flagged `test: true`.
- **Every denial path is tested**, not only the happy path.
