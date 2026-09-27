# Loogo Labs Security and Privacy Policies (Deemed Health)

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

Applies to all Loogo Labs workforce (employees, contractors, agents) with access
to Deemed Health systems or data. Adopted by the product owner (@jselvalugo,
roadmap D5). Reviewed annually and at each roadmap gate. Violations are handled
under §9.

## 1. Access control (164.308(a)(3), (a)(4); 164.312(a), (d))
- Deny by default; least privilege; access granted by role and approved by the
  security officer.
- MFA on every system (SSO, cloud console, repo, CI, email).
- No standing access to production data. Access is just-in-time, time-boxed,
  logged, and tied to a ticket. Customer data access for support requires a
  customer-granted, audited grant.
- Access reviewed quarterly; removed within 24 hours of role change or
  separation (same business day for involuntary separation).
- Shared accounts prohibited except sealed break-glass (ADR-0006).

## 2. Acceptable use and training (164.308(a)(5))
- Company-managed devices only for production or customer data: full-disk
  encryption, screen lock ≤ 5 min, OS auto-updates, endpoint protection.
- No customer data in personal email, chat, notes, local files, or unapproved AI
  tools. No production data in non-production (roadmap §2 rule 1).
- Report suspected incidents immediately (§5).
- HIPAA and security training at hire (before access) and annually; completion
  recorded. Phishing awareness included.

## 3. Change management
- All changes via pull request with at least one reviewer; `main` protected.
- CI blocking checks (roadmap §2 rule 3) must pass; no skipped tests.
- Features touching personal data get the `security-privacy-officer` checklist
  review; compliance features get `hrsa-regulatory-analyst` review.
- Infrastructure changed only through infrastructure as code. Emergency changes
  are reviewed after the fact within 2 business days.

## 4. Vendor management (164.308(b); 164.314(a))
- Every vendor that may receive customer data is listed in `subprocessors.md`
  before use, with data categories, BAA status, and US processing.
- A BAA (or subcontractor BAA) is signed before any PHI can reach the vendor.
- Security review at onboarding and annually (SOC 2 report or equivalent).

## 5. Incident response (164.308(a)(6))
Roles: incident lead (security officer), product owner, engineering on-call,
counsel as needed.
1. **Detect and report:** any workforce member reports to the security officer
   immediately. The report time is recorded.
2. **Triage:** severity (SEV1–SEV3); open an incident record.
3. **Contain, eradicate, recover.** Preserve evidence and logs; do not destroy
   data.
4. **Assess** whether PHI, PII, or FIPA personal information is involved; if so,
   start §6.
5. **Post-incident review** within 10 business days; update the risk analysis.
Security incidents affecting a customer are reported under the BAA terms
(164.314(a)(2)(i)(C)), including unsuccessful-attempt reporting as the BAA
specifies.

## 6. Breach notification — business associate procedure
Loogo Labs acts as a **business associate** and, under FIPA, likely a
**third-party agent**. We notify the **covered entity (customer)**; the customer
notifies individuals, HHS, media, and Florida agencies unless the BAA delegates it.

**Clock.** Discovery = first day the breach is known, or by reasonable diligence
would have been known, to any workforce member other than the person committing
it (164.410(a)(2)). The deadline is the **earliest** of:

| Source | Deadline to notify the customer | Status |
| --- | --- | --- |
| HIPAA 45 CFR 164.410(b) | Without unreasonable delay, no later than 60 calendar days after discovery | Planning assumption |
| Customer BAA | As written (often 5–10 days; target default in our template: 5 business days) | Per contract |
| **FIPA, Fla. Stat. §501.171(6)** | **Third-party agent notifies the covered entity within 10 days** of determining or reasonably suspecting a breach | **ASSUMPTION — TO VERIFY with counsel (FL-PRIV-1)**, including how FIPA interacts with HIPAA notices |

**Operating rule:** notify the affected customer **within 5 business days of
discovery and never later than 10 calendar days**, with facts as known, and
supplement as facts develop.

**Steps**
1. Within 24 h: incident lead confirms facts, involves the product owner and counsel.
2. Four-factor risk assessment (164.402): nature/extent of PHI and identifiers,
   unauthorized recipient, whether PHI was actually acquired or viewed, extent
   mitigated. Unsecured PHI only (encrypted per ADR-0007 with keys safe = secured).
   Document the conclusion either way.
3. Identify affected individuals per tenant, including Floridians' FIPA personal
   information (data dictionary FIPA tag) for the customer's own FIPA duties
   (individuals ≤ 30 days; Florida Department of Legal Affairs if ≥ 500;
   consumer reporting agencies if > 1,000 — all to verify).
4. Notice to customer (164.410(c)): identities of individuals where possible,
   description, dates, data types, what we are doing, contact.
5. Subcontractors: our BAAs require them to notify Loogo Labs promptly (target
   ≤ 5 days) so we can meet the above.
6. Retain all documentation 6 years (164.530(j) by reference; BAA).
7. Law-enforcement delay handled per 164.412 with written record.
Proven by a tabletop exercise before G4.

## 7. Retention and disposal
- Customer data retained for the contract term plus the period in the customer's
  BAA/terms; tenant-configurable retention by record type where catalog rules
  require it. Legal hold overrides deletion.
- Offboarding: export offered, then deletion within 90 days (crypto-shred of
  tenant keys, ADR-0007); backups age out on their schedule.
- HIPAA documentation (policies, risk analyses, incident records) kept 6 years
  from creation or last effective date (164.316(b)(2)).
- Media disposal per NIST SP 800-88; cloud deletion via provider guarantees.
  FIPA disposal duty (§501.171(8), to verify) is met by the same process.

## 8. Backup and disaster recovery (164.308(a)(7))
- Encrypted, versioned backups in a separate account; daily full + continuous
  point-in-time for Postgres; object versioning for evidence.
- Proposed targets: **RPO 1 hour, RTO 8 hours** (confirm in ADR-0005).
- Restore test into an isolated account before G4 and at least twice a year;
  results recorded.
- Emergency mode operation: read-only mode and status communications to customers.

## 9. Sanctions (164.308(a)(1)(ii)(C))
- Violations are graded: **Level 1** unintentional (e.g. data in wrong channel) →
  retraining and documented warning; **Level 2** negligent or repeated → written
  warning, access suspension, possible termination; **Level 3** intentional misuse,
  snooping, or disclosure → termination of employment or contract, and referral to
  authorities where law requires.
- Sanctions apply equally to all roles, including leadership and contractors.
- Each sanction is documented and retained 6 years.
- Reporting a problem in good faith is never sanctioned.

## 10. Information system activity review (164.308(a)(1)(ii)(D))
- Security officer reviews audit and production-access logs at least monthly and
  after alerts; findings recorded.
