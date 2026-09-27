# Subprocessors

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

Owner: `security-privacy-officer`. HIPAA basis: 45 CFR 164.308(b)(1),
164.314(a), 164.502(e). Florida: every subprocessor that handles customer data
processes it in the US (`florida.md` FL-PRIV-3; counsel to confirm §408.051
applicability). ADR-0004 and ADR-0005 are not yet written, so **no vendor is
named**. Update this table when those ADRs are Accepted.

| Category | Vendor | Data it may receive | PHI possible | BAA status | US processing | Needed by |
| --- | --- | --- | --- | --- | --- | --- |
| Hosting (compute, Postgres, object storage, KMS, backups) | TBD (ADR-0005) | All classes | Yes | Not signed — **required for G0** | Required; US regions only | G0 |
| Transactional email | TBD | Recipient name and email, minimized notification text; no PHI by design | Possible (misuse) | Not signed — required before G4 | Required | G4 |
| Error tracking / APM | TBD | Stack traces, scrubbed; no PII/PHI by design | Possible (leak) | Not signed — required before G4 | Required | G4 |
| AI provider | TBD (ADR-0004) | Minimized prompts via gateway | Possible | Not signed — required before Phase 6 | Required; zero/limited retention, no training | Phase 6 |
| Identity provider (if a vendor is chosen, ADR-0006) | TBD | Names, emails, auth events | No | Evaluate; BAA if it could see PHI | Required | G1 |
| Source code / CI | TBD | Code, no customer data | No | Not needed while synthetic data only | n/a | G0 |

Excluded by design: public data sources (LEIE, SAM.gov, NPPES, FL DOH MQA, AHCA)
receive only outbound queries and are not subprocessors of customer data;
query content (names, NPI, license numbers) is reviewed per integration.
