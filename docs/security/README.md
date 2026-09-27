# Security and Privacy

> **Draft — requires signature by the product owner/security officer.** Index of
> the Phase 0 security program for Deemed Health (roadmap §3). Everything below is
> a draft until signed.

Owner: `security-privacy-officer`. Decision owner: @jselvalugo (roadmap D5).
Context: Florida only (D4), no SSN collected (D1), Loogo Labs is a business associate.

## Documents
| Document | Purpose | Status |
| --- | --- | --- |
| [data-classification.md](data-classification.md) | Classes and data dictionary template | Draft |
| [risk-analysis.md](risk-analysis.md) | HIPAA Security Rule risk analysis v1 and risk management plan | Draft |
| [threat-model.md](threat-model.md) | STRIDE threat model v1 with owners and controls | Draft |
| [policies.md](policies.md) | Access, acceptable use/training, change, vendor, incident response, BA breach notification, retention, backup/DR, sanctions, activity review | Draft |
| [subprocessors.md](subprocessors.md) | Vendor categories, BAA status, US processing | Draft |
| [../adr/0006-identity-sso-mfa.md](../adr/0006-identity-sso-mfa.md) | Identity, MFA, sessions, SCIM | Proposed |
| [../adr/0007-encryption-and-key-management.md](../adr/0007-encryption-and-key-management.md) | Encryption and KMS | Proposed |

## Needs a human signature or action for gate G0
| # | Item | Who | Citation |
| --- | --- | --- | --- |
| 1 | Name the HIPAA **security officer** in writing | @jselvalugo | 164.308(a)(2) |
| 2 | Name the **privacy officer** in writing | @jselvalugo | 164.530(a) (by BAA reference) |
| 3 | Accept ADR-0006 and ADR-0007 (change Status to Accepted) | @jselvalugo + security officer | Roadmap §3 |
| 4 | Sign risk analysis v1 and risk management plan | Security officer + @jselvalugo | 164.308(a)(1)(ii)(A)–(B) |
| 5 | Sign threat model v1 | Security officer | Roadmap G0 |
| 6 | Adopt policies, including sanctions policy | @jselvalugo | 164.308(a)(1)(ii)(C), 164.316 |
| 7 | Choose hosting vendor (ADR-0005) and **sign the hosting BAA** | @jselvalugo | 164.308(b)(1), G0 |
| 8 | Record workforce HIPAA training completion | Security officer | 164.308(a)(5) |
| 9 | Engage counsel on FL-PRIV-1–4, including the FIPA 10-day agent deadline | @jselvalugo | Roadmap D3 |
