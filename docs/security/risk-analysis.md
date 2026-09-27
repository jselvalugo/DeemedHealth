# HIPAA Security Rule Risk Analysis v1 (planned system)

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

| Field | Value |
| --- | --- |
| Version | 1.0-draft, 2026-09-27 |
| Scope | Deemed Health as designed in Phase 0 (no system built, no real data) |
| Required by | 45 CFR 164.308(a)(1)(ii)(A) risk analysis; 164.308(a)(1)(ii)(B) risk management |
| Review | At every roadmap gate (G1–G5), on major change, and at least annually |
| Signers | Security officer (164.308(a)(2)); product owner @jselvalugo (D5) |

## 1. Method
Qualitative, following NIST SP 800-30 as referenced by HHS guidance. Likelihood
and impact are rated 1 (low) to 3 (high); **risk = L × I** (1–2 low, 3–4 medium,
6–9 high). Ratings are **inherent** (before planned controls) and **residual**
(after them). Residual risk above 4 needs a named owner and a date, or written
acceptance by the product owner.

## 2. Scope and ePHI inventory
Business-associate role: ePHI enters only through FTCA incidents (Phase 3+) and
grievances (Phase 7). Staff/board PII is not PHI but is protected the same way.
Florida only (D4); no SSN (D1).

| Asset | Data | Location (planned) |
| --- | --- | --- |
| A1 Postgres (multi-tenant, RLS) | PII, PHI (encrypted fields), audit log | HIPAA-eligible US cloud (ADR-0005) |
| A2 Evidence object store | Uploaded documents (may contain PII/PHI) | Same, versioned, SSE-KMS |
| A3 Web and API services | All classes in transit | Same |
| A4 Job queue and workers | Screening, notification, integration payloads | Same |
| A5 KMS and secrets manager | Keys, integration credentials | Same |
| A6 Backups | Full copies of A1, A2 | Same, separate account |
| A7 Email provider | Notifications (minimized; no PHI by design) | Subprocessor, TBD |
| A8 Error tracking / logs | Must hold no PII/PHI | Subprocessor, TBD |
| A9 AI provider (Phase 6) | Minimized prompts | Subprocessor, TBD (ADR-0004) |
| A10 Integrations | LEIE, SAM.gov, NPPES, FL DOH MQA, AHCA | Outbound only |
| A11 CI/CD and source repo | Code, build secrets | GitHub + CI |
| A12 Workforce endpoints | Admin access | Loogo Labs laptops |

## 3. Risk register

| # | Threat / vulnerability | Assets | L | I | Inh. | Planned controls | Res. | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Cross-tenant data exposure through a missing tenant filter or IDOR | A1, A2, A3 | 3 | 3 | 9 | RLS + service tenant check (ADR-0002), cross-tenant tests in CI, pen test (G4) | 3 | data-architect |
| R2 | Account takeover (phishing, credential stuffing) | A3 | 3 | 3 | 9 | SSO, MFA for all, no SMS, lockout, step-up (ADR-0006) | 3 | security-privacy-officer |
| R3 | Excess privilege / insider misuse by tenant user | A1 | 2 | 3 | 6 | Least-privilege roles, site scope, masked fields, audited reveals, quarterly access review | 3 | security-privacy-officer |
| R4 | Loogo Labs workforce access to production data | A1, A5, A6 | 2 | 3 | 6 | No standing access, JIT, break-glass, production access logged, training, sanctions | 2 | platform-devops-engineer |
| R5 | Malicious or malformed upload | A2 | 3 | 2 | 6 | Virus scan, content-type validation, size limits, no inline render, pre-signed short-lived URLs | 2 | backend-engineer |
| R6 | SSRF through integrations or URL fetch | A4, A5 | 2 | 3 | 6 | Fixed allowlist of hosts, egress proxy, block metadata/IP ranges | 2 | integrations-engineer |
| R7 | Bulk exfiltration through exports | A1, A2 | 2 | 3 | 6 | Step-up, audited exports, rate limits, watermark, expiring links | 3 | backend-engineer |
| R8 | Prompt injection / data leak via AI | A9 | 3 | 2 | 6 | Gateway, tenant-scoped retrieval, no PHI by default, output never acts (ADR-0004) | 2 | ai-assistant-engineer |
| R9 | PII/PHI leaking into logs, error tracker, analytics, email | A7, A8 | 3 | 2 | 6 | Structured logs with redaction, scrubbers, lint rule, notification content minimized | 2 | backend-engineer |
| R10 | Audit log tampering | A1 | 1 | 3 | 3 | Append-only, hash chain (ADR-0008), separate write role | 1 | data-architect |
| R11 | Key or secret compromise | A5 | 1 | 3 | 3 | KMS, least privilege, rotation, secret scanning (ADR-0007) | 2 | platform-devops-engineer |
| R12 | Data loss / ransomware / region outage | A1, A2, A6 | 2 | 3 | 6 | Encrypted versioned backups in separate account, tested restore, RPO/RTO (G4) | 3 | platform-devops-engineer |
| R13 | Supply-chain compromise | A11 | 2 | 3 | 6 | Lockfiles, dependency/secret scanning, signed builds, pinned images, branch protection | 2 | platform-devops-engineer |
| R14 | Production data copied to non-production | A1 | 2 | 3 | 6 | Separate accounts, synthetic data only, no cross-account restore rights, PREVIEW banner | 1 | platform-devops-engineer |
| R15 | Subprocessor without BAA receives PHI | A7–A9 | 2 | 3 | 6 | Subprocessor list, BAA before PHI (164.308(b)), US processing (FL-PRIV-3) | 2 | security-privacy-officer |
| R16 | Out-of-scope data captured (SSN, Part 2 SUD, clinical) | A1, A2 | 2 | 3 | 6 | No SSN fields, SSN-pattern rejection, Part 2 warnings on incident/grievance forms | 3 | security-privacy-officer |
| R17 | Late breach notice (HIPAA 164.410, BAA, FIPA 10-day agent) | Process | 2 | 3 | 6 | Breach procedure with stricter-of clock, tabletop (G4) | 2 | security-privacy-officer |
| R18 | Session hijack on shared clinic workstation | A3 | 2 | 2 | 4 | 15-min idle timeout, secure cookies, step-up | 2 | security-privacy-officer |

## 4. Risk management plan (164.308(a)(1)(ii)(B))
Each control above is tracked to the gate in roadmap §12. Controls due by:
- **G0:** policies, subprocessor list, ADR-0002/0006/0007/0008, CI supply-chain controls (R13).
- **G1:** R1, R2, R3, R5, R9, R10, R11, R14, R16 implemented and tested on synthetic data.
- **G2:** R6, R7 (integrations and exports).
- **G3:** PHI handling for incidents (R8 excluded until Phase 6).
- **G4:** R4, R12, R15, R17, pen test, updated analysis for production.
- **Phase 6 gate:** R8.

## 5. Related administrative safeguards (45 CFR 164.308)
| Standard | Citation | Where addressed |
| --- | --- | --- |
| Security management process: risk analysis, risk management, sanctions, information system activity review | 164.308(a)(1)(ii)(A)–(D) | This document; `policies.md` §2, §9; audit review |
| Assigned security responsibility | 164.308(a)(2) | README (named officer) |
| Workforce security | 164.308(a)(3) | `policies.md` §1 |
| Information access management | 164.308(a)(4) | ADR-0006, `policies.md` §1 |
| Security awareness and training | 164.308(a)(5) | `policies.md` §2 |
| Security incident procedures | 164.308(a)(6) | `policies.md` §5 |
| Contingency plan | 164.308(a)(7) | `policies.md` §8 |
| Evaluation | 164.308(a)(8) | Gate reviews, annual review |
| Business associate contracts | 164.308(b)(1); 164.314(a) | `subprocessors.md`, `policies.md` §7 |

## 6. Accepted risks
None proposed. Any acceptance is recorded here with signer and date.
