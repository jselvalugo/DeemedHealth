# ADR-0007: Encryption and key management

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

**Status:** Proposed
**Owners:** `security-privacy-officer` + `data-architect` · **Decider:** @jselvalugo
**Depends on:** ADR-0002 (tenancy), ADR-0005 (hosting, regions), ADR-0008 (audit)

## Context
HIPAA treats encryption as addressable (45 CFR 164.312(a)(2)(iv), 164.312(e)(2)(ii));
we adopt it as required. Encryption consistent with HHS guidance also makes lost
data "secured" for breach purposes (164.402). FIPA (Fla. Stat. §501.171, to verify)
exempts encrypted data from notice unless the key is also compromised. Roadmap
decision D1: **no SSN is collected**, so SSN is not in scope here.

## Decision
1. **In transit:** TLS 1.2+ (1.3 preferred) on every hop, including internal
   service-to-service and database connections (`sslmode=verify-full`). HSTS.
   No plaintext endpoints.
2. **At rest:** KMS-managed encryption for the Postgres volumes and snapshots,
   object storage (SSE-KMS, bucket policy denies unencrypted puts), backups,
   queues, and logs.
3. **Field-level (application-layer) envelope encryption** for:
   DOB, DEA number, home address, FTCA incident narratives, grievance narratives
   (Phase 7), and integration credentials. Each value is encrypted with a data key
   (AES-256-GCM) wrapped by a **per-tenant KMS key** (or per-tenant key derived
   under an environment KMS key if the provider's key quota requires; decided in
   implementation, both keep tenant separation). Associated data binds
   `tenant_id`, table, column, and record id to stop ciphertext swapping.
4. **Search on encrypted fields** where needed (DOB for screening matches) uses a
   keyed HMAC blind index with a separate key; no plaintext indexes.
5. **Key hierarchy and separation:** separate KMS keys per environment and
   account (ADR-0005); production keys cannot be used from non-production.
   Key policies grant decrypt only to the service role that needs it; humans
   cannot decrypt through the console without break-glass.
6. **Rotation:** KMS root keys rotate automatically every 12 months; data keys
   re-wrapped on rotation (no bulk re-encrypt needed). Blind-index keys rotate
   on compromise with a reindex job. Integration secrets rotate every 90 days
   or on staff change.
7. **Secrets:** stored in the cloud secrets manager, never in the repo,
   environment files, or CI logs. Secret scanning blocks CI (roadmap §2 rule 3).
8. **Reveal flow:** encrypted fields are masked in UI and API by default;
   plaintext is returned only by an explicit reveal endpoint that requires
   step-up (ADR-0006) and writes an audit event (ADR-0008).
9. **Crypto hygiene:** standard libraries only (cloud KMS SDK / vetted AEAD), no
   custom crypto. FIPS 140-validated KMS modules preferred.
10. **Tenant offboarding:** after the retention period, the tenant's key is
    scheduled for deletion (crypto-shredding), subject to legal hold.

## Alternatives considered
- **Disk encryption only:** rejected; does not protect against application or
  DBA-level reads, and cannot audit reveals.
- **Postgres pgcrypto with keys in the DB:** rejected; key sits beside data.
- **One key for all tenants:** rejected; weaker isolation and no crypto-shredding.
- **Customer-managed keys (BYOK):** deferred to Phase 8.

## Consequences
- Encrypted fields cannot be sorted or range-queried; design screens accordingly.
- KMS cost and latency; cache unwrapped data keys in memory briefly (max 5 min).
- Backups remain decryptable only while the KMS key exists; key deletion windows
  must exceed backup retention.
