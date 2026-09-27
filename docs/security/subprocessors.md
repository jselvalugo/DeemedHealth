# Subprocessors

> **Approved and signed** by @jselvalugo, product owner, HIPAA security officer
> (45 CFR 164.308(a)(2)) and privacy officer, on 2026-09-27. In force from that date.
> Regulatory citations remain planning assumptions to verify against the current source.

Owner: `security-privacy-officer`. HIPAA basis: 45 CFR 164.308(b)(1),
164.314(a), 164.502(e). Florida: every subprocessor that handles customer data
processes it in the US (`florida.md` FL-PRIV-3; counsel to confirm §408.051
applicability). Vendors named below follow ADR-0005 (Proposed) and ADR-0009 (Accepted).
Update this table when ADR-0004 and ADR-0005 are Accepted.

| Category | Vendor | Data it may receive | PHI possible | BAA status | US processing | Needed by |
| --- | --- | --- | --- | --- | --- | --- |
| Hosting, production (compute, Postgres, object storage, KMS, backups) | AWS (ADR-0005) | All classes | Yes | Pending — to be accepted via AWS Artifact; **required for G0** | Required; `us-east-1` and `us-east-2` only | G0 |
| Hosting, non-production only (web previews, dev/staging) | Netlify (ADR-0009) | Synthetic data and code only. **Must never receive PHI or PII** | No (prohibited) | None; no BAA, so no customer data | n/a (no customer data) | Now |
| Transactional email | TBD | Recipient name and email, minimized notification text; no PHI by design | Possible (misuse) | Not signed — required before G4 | Required | G4 |
| Error tracking / APM | TBD | Stack traces, scrubbed; no PII/PHI by design | Possible (leak) | Not signed — required before G4 | Required | G4 |
| AI provider | TBD (ADR-0004) | Minimized prompts via gateway | Possible | Not signed — required before Phase 6 | Required; zero/limited retention, no training | Phase 6 |
| Identity provider (if a vendor is chosen, ADR-0006) | TBD | Names, emails, auth events | No | Evaluate; BAA if it could see PHI | Required | G1 |
| Source code / CI | GitHub | Code and synthetic fixtures; no customer data | No | Not needed; no customer data | n/a | G0 |

Excluded by design: public data sources (LEIE, SAM.gov, NPPES, FL DOH MQA, AHCA)
receive only outbound queries and are not subprocessors of customer data;
query content (names, NPI, license numbers) is reviewed per integration.
