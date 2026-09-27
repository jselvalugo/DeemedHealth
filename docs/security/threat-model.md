# Threat Model v1 (STRIDE)

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

Scope: the planned platform (web, API, workers, Postgres with RLS, evidence
store, integrations, exports, AI gateway). Trust boundaries: browser ↔ API;
API ↔ database (tenant context); API ↔ object store; workers ↔ external sources;
gateway ↔ AI provider; CI ↔ production. Risk IDs refer to `risk-analysis.md`.

S = Spoofing, T = Tampering, R = Repudiation, I = Information disclosure,
D = Denial of service, E = Elevation of privilege.

## Tenancy
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| TN-1 | I | Query without tenant filter returns another tenant's rows | Postgres RLS on every tenant table keyed on `app.tenant_id` set per transaction; service-layer check; CI test that every table has a policy | data-architect | R1 |
| TN-2 | I/E | IDOR: guessing a record id in another tenant | UUIDs plus authorization by tenant and site on every read; cross-tenant negative tests per endpoint | backend-engineer | R1 |
| TN-3 | E | Connection pool reuses tenant context across requests | `SET LOCAL` in transaction only; pool reset; test | data-architect | R1 |
| TN-4 | I | Background job runs with wrong or no tenant | Jobs carry tenant id; worker sets context; jobs without it fail closed | backend-engineer | R1 |
| TN-5 | I | Cache or search index mixes tenants | Tenant id in every cache key and index; tests | backend-engineer | R1 |

## Authentication and sessions
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| AU-1 | S | Phished password or credential stuffing | SSO + mandatory MFA, WebAuthn preferred, no SMS, lockout (ADR-0006) | security-privacy-officer | R2 |
| AU-2 | S | Forged or replayed SAML/OIDC assertion | Signature validation, audience/issuer checks, nonce/replay cache, library not hand-rolled | backend-engineer | R2 |
| AU-3 | S | Session theft / fixation | HttpOnly Secure cookies, rotation on login, 15-min idle, CSP | backend-engineer | R18 |
| AU-4 | E | Deprovisioned user keeps access | SCIM revocation within 60 s; session revalidation | backend-engineer | R3 |
| AU-5 | E | Tenant admin grants self or others excess roles | Step-up for role changes, audit, notification to compliance officer | security-privacy-officer | R3 |
| AU-6 | R | User denies approving or revealing | Audit events with actor, time, before/after, hash chain (ADR-0008) | data-architect | R10 |
| AU-7 | E | Auditor access outlives engagement | Mandatory end date, auto-expiry | backend-engineer | R3 |

## Evidence uploads
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| UP-1 | T | Malware uploaded and shared to other users | Virus scan before availability; quarantine state | backend-engineer | R5 |
| UP-2 | T/E | Polyglot/HTML/SVG file served inline (stored XSS) | Content sniffing + allowlist of types, `Content-Disposition: attachment`, separate download domain, `nosniff` | backend-engineer | R5 |
| UP-3 | I | Leaked download URL | Pre-signed URLs, 5-min expiry, no public buckets, audited download | platform-devops-engineer | R7 |
| UP-4 | D | Huge or zip-bomb files | Size limits, decompression limits, per-tenant quotas | backend-engineer | R5 |
| UP-5 | I | Out-of-scope data (SSN, Part 2, clinical) in uploads | Upload warnings; SSN-pattern detection on extracted text flags for review | security-privacy-officer | R16 |
| UP-6 | T | Evidence altered after approval | Object versioning, legal hold, hash stored with record | data-architect | R10 |

## Integrations (SSRF)
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| IN-1 | I/E | SSRF to cloud metadata or internal services via a configurable URL | No user-supplied URLs; fixed host allowlist (LEIE, SAM.gov, NPPES, FL DOH MQA, AHCA); egress proxy denying private and link-local ranges; IMDSv2 | integrations-engineer | R6 |
| IN-2 | T | Poisoned or spoofed source data (e.g. fake "no match") | TLS verification, checksum where published, source version recorded; a human clears matches (roadmap §2 rule 4) | integrations-engineer | R6 |
| IN-3 | I | Integration credentials leak | Secrets manager, field-level encryption, rotation (ADR-0007) | integrations-engineer | R11 |
| IN-4 | D | External source down or rate-limits | Retries with backoff, stale-data indicator, no silent pass | integrations-engineer | R12 |
| IN-5 | T | Injection from parsed files (CSV formula, XML XXE) | Safe parsers, XXE off, CSV escaping on export | integrations-engineer | R6 |

## Exports
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| EX-1 | I | Bulk exfiltration by a compromised or malicious user | Step-up, role check, audited export, rate limit, alert on volume | backend-engineer | R7 |
| EX-2 | I | Export includes masked fields in plaintext | Exports honor masking; reveal-in-export needs explicit permission and audit | backend-engineer | R7 |
| EX-3 | T | CSV formula injection opens attack on recipient | Escape leading `= + - @` | backend-engineer | R7 |
| EX-4 | I | Export presented as HRSA determination | Watermark "internal readiness, not an HRSA determination" (roadmap §2 rule 5) | hrsa-regulatory-analyst | — |
| EX-5 | I | Export file lingers | Expiring links, auto-delete after 24 h | backend-engineer | R7 |

## AI (prompt injection)
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| AI-1 | T/E | Instructions in an uploaded document make the assistant take actions or change data | Assistant has no write tools that approve/attest/submit; any write is a draft a human confirms; tool calls authorized as the user (ADR-0004) | ai-assistant-engineer | R8 |
| AI-2 | I | Injection makes the model reveal other tenants' or restricted data | Retrieval scoped to the user's tenant, site, and role before the prompt is built; no PHI by default | ai-assistant-engineer | R8 |
| AI-3 | I | Exfiltration via rendered links/images in output | Output rendered as text; no auto-fetched URLs; link allowlist | ai-assistant-engineer | R8 |
| AI-4 | I | Prompts or outputs stored/used for training by provider | BAA, zero-retention or limited-retention terms, US processing | security-privacy-officer | R15 |
| AI-5 | R | Wrong AI answer relied on as fact | Citations required, draft labeling, eval gate per capability | ai-assistant-engineer | — |

## Cross-cutting
| ID | STRIDE | Threat | Control | Owner | Risk |
| --- | --- | --- | --- | --- | --- |
| CC-1 | I | PII/PHI in logs, traces, error tracker | Redaction middleware, scrubbers, lint rule, periodic log sampling review | backend-engineer | R9 |
| CC-2 | T | Malicious dependency or CI compromise | Lockfiles, scanning, signed builds, pinned digests, protected branches | platform-devops-engineer | R13 |
| CC-3 | D | Application-layer DoS | WAF, rate limits, DDoS protection (G4) | platform-devops-engineer | R12 |
| CC-4 | T | SQL injection | ORM parameterized queries only; raw SQL reviewed; SAST | backend-engineer | R1 |
