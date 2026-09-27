# Data Classification and Data Dictionary Template

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

Owner: `security-privacy-officer`. Every new field is classified in the data
dictionary before its PR merges (review checklist item 1).

## 1. Classes

| Class | Definition | Examples | Required handling |
| --- | --- | --- | --- |
| **Public** | Meant for anyone | Marketing pages, public HRSA source text, published catalog citations | No restrictions; integrity controls only |
| **Internal** | Loogo Labs or tenant operational data, low harm if disclosed | Module config, requirement status, task titles without personal data | Authenticated access; tenant isolation |
| **Confidential** | Business-sensitive tenant data, not personal | Contracts, budgets, board minutes, scope of project, audit log | Tenant isolation, RBAC, audited export, encrypted at rest |
| **PII** | Identifies a person (staff, provider, board member) | Name, work email, phone, NPI, license #, **DOB**, **DEA #**, **home address** | All Confidential controls; masked by default for **bold** fields; field-level encryption and audited reveal for bold fields; never in logs/URLs/analytics |
| **PHI** | Individually identifiable health information received as a business associate | FTCA incident narratives, grievance narratives, patient identifiers in them | All PII controls; field-level encryption; minimum necessary; excluded from AI prompts unless ADR-0004 allows; BAA required for every subprocessor that can see it |

**Prohibited (never collected):** Social Security numbers (roadmap D1; SSN-shaped
values are rejected), 42 CFR Part 2 SUD records, payment card data, patient
clinical records, full background-check reports (Florida Level 2: status and
date only, `florida.md` §4). Forms that could capture these show a warning.

**Florida tag:** mark fields that are "personal information" under FIPA
(Fla. Stat. §501.171, e.g. name plus medical or health-insurance information,
username plus password; list to verify under FL-PRIV-2). FIPA-tagged fields feed
the breach scoping in `policies.md` §6.

When a record mixes classes, the record takes the highest class present.

## 2. Data dictionary template

One row per field. Lives beside the schema (`packages/domain` or the
data-architect's chosen location) and is reviewed in every PR that adds a field.

| Column | Meaning |
| --- | --- |
| `entity.field` | Table and column (or API field) |
| Description | Plain-language meaning |
| Class | Public / Internal / Confidential / PII / PHI |
| FIPA PI | yes / no / to verify |
| Source | User entry, import, integration (name), derived |
| Purpose / requirementId | Why we need it; catalog `requirementId` or "non-regulatory" |
| Minimum necessary | Why a less sensitive form would not do |
| Encryption | At rest only / field-level (key scope) |
| Display default | Shown / masked (pattern) / hidden |
| Reveal audited | yes / no |
| Roles that can read | From module-map roles; site scoping |
| Allowed in AI prompts | no / yes, redacted / yes |
| Allowed in notifications | no / yes (what part) |
| Retention | Period and trigger (e.g. 7 years after separation) |
| Deletion | Hard delete / crypto-shred / legal hold behavior |
| Owner agent | Who maintains the field |

### Example rows

| entity.field | Class | FIPA PI | Encryption | Display | Reveal audited | AI prompts | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| provider.date_of_birth | PII | to verify | field-level (tenant key) + HMAC index | masked `**/**/YYYY` | yes | no | tenant policy; default life of record + 7 y |
| provider.dea_number | PII | to verify | field-level | masked last 3 | yes | no | same |
| provider.npi | PII | no | at rest | shown | no | yes | same |
| incident.narrative | PHI | yes | field-level | hidden until opened | yes | no (until ADR-0004 allows) | per FTCA/risk policy, to verify |
