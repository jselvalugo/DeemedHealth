# ADR-0008: Audit log

> **Superseded in part by ADR-0011** (tenancy naming): `app_rw` below means the
> runtime role `app_user`. `audit_writer` (no login) and `audit_retention` are
> confirmed in the ADR-0002 role list.

Owner: `data-architect`. Reviewers: `security-privacy-officer`, `backend-engineer`,
`suite-architect`. Related: ADR-0002 (tenancy and RLS), ADR-0005 (hosting and
regions), ADR-0006 (identity), ADR-0007 (encryption and key management).

## Context

Product principle 5 says every create, update, approve, and export is written to
an append-only audit log with actor, timestamp, and before/after. Gate G1
(roadmap §4) makes this testable:

- an audit event exists for every mutation, reveal, export, approval, login, and
  permission change;
- the hash chain verifies, and a tampered row fails verification;
- the application's database role has no UPDATE or DELETE on `audit_event`;
- a customer admin can view and export its own audit log.

The log is also the backbone of "what was our status on date X, and what
evidence supported it?" It records who changed a credential, who revealed a DEA
number, who approved a privilege set, and when an exclusion screening ran.

Constraints:

- **HIPAA documentation retention.** 45 CFR 164.316(b)(2) requires six years
  from creation or last effective date. Audit controls are required by
  164.312(b).
- **Legal hold.** Litigation, an FTCA claim, or an HRSA or OIG inquiry can
  require keeping records past their retention date.
- **Multi-tenant.** Every tenant row has `organization_id NOT NULL` and RLS
  (ADR-0002). Customers must be able to export and verify their own log without
  seeing anyone else's.
- **PHI minimization.** The log must not become a second, unencrypted copy of
  DOB, DEA #, home address, or incident and grievance narratives (ADR-0007).
  Decision D1 means no SSN exists to leak, and the log must never hold one.
- **Florida only (D4).** All storage, including anchors, stays in US regions
  (ADR-0005, FL-PRIV-3). FIPA (FL-FIPA) disposal rules apply when records are
  finally destroyed.
- **Volume.** Expect millions of rows per tenant per year once integrations run
  daily. Queries are nearly always "one tenant, a time range".

## Decision

### 1. Storage: an append-only Postgres table

`audit_event` lives in the primary PostgreSQL cluster, in its own schema
`audit`, so that audit writes commit in the **same transaction** as the business
change they describe. If the business write rolls back, the audit row rolls back
with it; there is no "changed but not logged" window.

```sql
CREATE TABLE audit.audit_event (
  id               uuid        NOT NULL,           -- UUIDv7 (time-ordered)
  organization_id  uuid        NOT NULL,           -- tenant; platform events use the platform tenant id
  chain_seq        bigint      NOT NULL,           -- 1..n per organization, gapless
  occurred_at      timestamptz NOT NULL,           -- UTC, set by the database (clock_timestamp())
  category         text        NOT NULL,           -- see §4
  action           text        NOT NULL,           -- e.g. 'credential.update'
  outcome          text        NOT NULL,           -- 'success' | 'denied' | 'failure'
  actor_type       text        NOT NULL,           -- 'user' | 'service' | 'integration' | 'system' | 'break_glass'
  actor_person_id  uuid,                           -- null for service/system actors
  actor_user_id    uuid,                           -- identity account (ADR-0006)
  actor_label      text        NOT NULL,           -- display name at the time of the event
  on_behalf_of_id  uuid,                           -- impersonation / support access, if ever allowed
  session_id       uuid,
  request_id       uuid,                           -- correlation id shared with logs and traces
  ip_address       inet,
  user_agent       text,
  site_id          uuid,                           -- for site-scoped queries and RBAC
  target_table     text,
  target_id        uuid,
  requirement_ids  text[],                         -- catalog requirementIds the change touches
  reason           text,                           -- required for reveals, overrides, break-glass, hard deletes
  diff             jsonb,                          -- redacted before/after, see §5
  metadata         jsonb       NOT NULL DEFAULT '{}',
  schema_version   smallint    NOT NULL,           -- version of the canonical form, see §2
  prev_hash        bytea       NOT NULL,           -- 32 bytes
  row_hash         bytea       NOT NULL,           -- 32 bytes
  PRIMARY KEY (organization_id, occurred_at, id),
  UNIQUE (organization_id, chain_seq, occurred_at)
) PARTITION BY RANGE (occurred_at);
```

Privileges:

- `app_rw` (the API role) has `INSERT` and `SELECT` only. It has **no UPDATE,
  DELETE, TRUNCATE, or REFERENCES** on `audit.audit_event` or its partitions.
  Inserts go through `audit.append_event(...)`, a `SECURITY DEFINER` function
  owned by `audit_writer`, which assigns `chain_seq`, `occurred_at`,
  `prev_hash`, and `row_hash` so the caller cannot supply them.
- A `BEFORE UPDATE OR DELETE OR TRUNCATE` trigger raises an exception for every
  role, including the table owner, as a second line of defense.
- `audit_retention` is the only role that can detach and drop partitions, and
  only through the retention job (§8). Its credentials live in the secret
  manager and are not available to the API.
- A CI migration check fails if any migration grants UPDATE or DELETE on the
  audit schema or disables the trigger. A G1 test connects as `app_rw` and
  asserts UPDATE and DELETE fail with a permission error.

Other append-only rules:

- Business tables use soft delete (`archived_at`); archiving is an ordinary
  `mutation` event.
- Corrections are new events (`action = 'audit.annotation'`) that reference the
  earlier event's id. Nothing is edited in place.

### 2. Hash chain

**One chain per organization.** A per-tenant chain lets a customer verify its own
export without any other tenant's rows, keeps RLS simple, and avoids a global
lock on every write.

**Algorithm.** SHA-256.

```
row_hash = SHA-256( prev_hash || canonical_bytes(row) )
```

`||` is byte concatenation; `prev_hash` is the raw 32 bytes.

**Canonical serialization.**

- The row is turned into a JSON object containing every column except
  `row_hash` (and including `prev_hash`, hex-encoded), then serialized with the
  JSON Canonicalization Scheme (**RFC 8785, JCS**): sorted keys, no
  insignificant whitespace, UTF-8, and the ECMAScript number format.
- Fixed type rules: UUIDs as lowercase hyphenated strings; timestamps as
  RFC 3339 UTC with microseconds (`2026-09-27T14:03:11.123456Z`); `bytea` as
  lowercase hex; `inet` in its canonical text form; SQL NULL as JSON `null`
  (the key is always present); arrays keep their order.
- `schema_version` is part of the hashed content. Adding a column bumps it, and
  the verifier keeps a serializer for every version. Old rows are never
  re-hashed.
- The canonicalizer lives in one package (`packages/domain/audit-canonical`) and
  is used by the writer, the verification job, and the customer verification
  tool. Golden-file tests pin the exact bytes for sample rows.

The **database function** is the single writer: it computes the hash
with `pgcrypto`'s `digest()` over a canonical text built by a PL/pgSQL
serializer, and the TypeScript canonicalizer must produce identical bytes. The
golden-file tests run against both, and CI fails on any difference.

**Ordering and concurrency.** `append_event` takes
`pg_advisory_xact_lock(hashtext('audit:' || organization_id))`, reads the
tenant's head from `audit.chain_head (organization_id, chain_seq, row_hash)`,
writes the new row, and updates `chain_head`, all in the caller's transaction.
Writes are serialized per tenant only. `chain_head` is the one audit table the
writer role may UPDATE, and only through this function; its value is
re-derivable from `audit_event`, so it is not itself evidence.

**Genesis row.** When an organization is provisioned, the first event is
`category = 'system'`, `action = 'audit.genesis'`, `chain_seq = 1`, and
`prev_hash` = 32 zero bytes. Its `metadata` records the organization id, the
creation time, the `schema_version`, and the id of the platform deployment.
The platform tenant (Loogo Labs operator events) has its own genesis row.

**Verification job.**

- **Incremental, hourly:** for each tenant, recompute hashes from the last
  verified `chain_seq` to the head; check that `chain_seq` has no gaps and that
  each `prev_hash` equals the previous `row_hash`.
- **Full, weekly:** recompute every tenant's chain from genesis (or from the
  latest retention checkpoint, §8) and compare it with the external anchors
  (§9).
- Results go to `audit.verification_run` (tenant, range, result, first bad
  `chain_seq`) and are themselves audit events in the platform tenant.
- Any mismatch raises a security alert to `security-privacy-officer` and starts
  the incident response procedure. It never "repairs" the chain.
- The same verifier ships as a small open CLI so customers and assessors can
  verify an export offline.

### 3. Monthly partitioning

- `audit_event` is range-partitioned by `occurred_at` into monthly partitions
  (`audit_event_2026_10`, ...), boundaries in UTC.
- A scheduled job creates partitions three months ahead; a missing partition is
  an alert, and a `DEFAULT` partition is not created (an insert with no
  partition fails loudly rather than landing somewhere unplanned).
- Indexes per partition: `(organization_id, occurred_at)`,
  `(organization_id, target_table, target_id)`,
  `(organization_id, actor_person_id, occurred_at)`,
  `(organization_id, category, occurred_at)`.
- Partitions older than 13 months may move to cheaper storage but stay
  queryable until retention (§8).
- Monthly partitions line up with retention: whole partitions are dropped, never
  individual rows.

### 4. Event taxonomy

`category` is a closed enum; `action` is a registered string
`<entity>.<verb>` listed in `packages/domain/audit-actions.ts`. An unregistered
action fails the insert (check against `audit.action_registry`).

| Category | Covers | Examples | Required fields |
| --- | --- | --- | --- |
| `auth` | Sign-in, sign-out, MFA challenge, failed login, session expiry, re-authentication, SCIM provisioning and deprovisioning, break-glass use | `session.login`, `session.login_failed`, `session.reauth`, `scim.user_deprovisioned`, `breakglass.activated` | outcome, ip, user agent |
| `mutation` | Create, update, archive, restore on any business record, including imports (one event per row changed plus a summary event per import run) | `credential.update`, `evidence_version.create`, `import.commit` | target, diff |
| `reveal` | Reading a field-encrypted value in clear text (DOB, DEA #, home address, incident or grievance narrative), and downloading an evidence file | `person.reveal_dob`, `evidence.download` | target, field name, reason |
| `export` | Any report, CSV/XLSX, PDF packet, or audit-log export | `report.export`, `audit.export` | scope, row count, format, file SHA-256 |
| `approval` | Approve, reject, sign, attest, committee decision, board vote recorded | `privilege_set.approve`, `committee_decision.record`, `attestation.sign` | target, decision, workflow_run id |
| `permission` | Role grant or revoke, site scope change, auditor role creation and expiry, policy changes to RBAC | `role.grant`, `auditor_access.expired` | subject person, before/after |
| `integration` | A run against an external source (LEIE, SAM.gov, AHCA, NPPES, FL DOH MQA, CAQH): start, finish, counts, failures | `screening_run.complete`, `license_sync.failed` | source, run id, counts |
| `system` | Genesis, retention job actions, legal hold set or released, verification runs, key rotation, catalog release applied | `audit.genesis`, `retention.hard_delete`, `legal_hold.set` | reason |

Denied attempts are logged too (`outcome = 'denied'`) for `auth`, `reveal`,
`export`, `approval`, and `permission`. AI actions are logged with
`actor_type = 'service'` and the human user in `on_behalf_of_id`; AI never
produces `approval` events (product principle 2).

### 5. Before/after diff and redaction

`diff` holds only the columns that changed:

```json
{ "fields": {
    "status":     { "before": "pending", "after": "verified" },
    "valid_to":   { "before": "2026-12-31", "after": "2028-12-31" },
    "dea_number": { "before": {"ref": "enc:v3:9f2c...", "changed": true},
                    "after":  {"ref": "enc:v3:41aa...", "changed": true} }
} }
```

Rules, driven by the sensitivity class in the data dictionary:

| Sensitivity class | What goes in the diff |
| --- | --- |
| public, internal | Before and after values in clear |
| confidential | Before and after values in clear, unless the column is also field-encrypted |
| PII or PHI that is field-encrypted (DOB, DEA #, home address, narratives) | Never the plaintext and never the ciphertext. A **reference**: key version plus a keyed HMAC of the ciphertext (`enc:v<n>:<hmac>`), so reviewers can see *that* it changed and correlate two events without reading the value. The historical value itself stays in the source table's version history (e.g. `evidence_version`), readable only through an audited reveal |
| Free-text fields that may contain PHI | `{"redacted": true, "length": n, "sha256": ...}` |
| Files | Object key, SHA-256, size, MIME type; never the content |

- Redaction happens in the audit middleware from the column registry generated
  from the data dictionary. A column without a sensitivity class fails CI.
- A G1 test writes known fake DOBs and DEA numbers and asserts they appear in no
  `audit_event` row, log, or trace.
- There is no SSN column (D1), and the redactor also rejects any value matching
  an SSN pattern as defense in depth.

### 6. Per-tenant RLS and customer export

- RLS is enabled and **forced** on `audit_event`:
  `USING (organization_id = current_setting('app.organization_id')::uuid)`,
  following ADR-0002's per-transaction tenant setting. There is no INSERT
  policy bypass: `append_event` also checks that the tenant argument equals
  the session tenant.
- Within a tenant, RBAC narrows further in the API: the customer admin and the
  time-boxed auditor role can read the whole tenant log; site-scoped roles see
  events for their sites; staff see events about themselves in Self-Service.
- Loogo Labs operator access to a tenant's log uses break-glass (ADR-0006) and
  is itself an audit event in both the platform chain and the tenant chain.
- A cross-tenant test (G1) sets tenant A and asserts zero rows and failed
  inserts for tenant B.

**Customer export** (Administration > Audit log > Export):

- Formats: newline-delimited JSON in canonical form (verifiable) and CSV
  (readable). Filters: date range, category, actor, target.
- Each export includes a manifest: organization id, `chain_seq` range, the
  `prev_hash` of the first row, the `row_hash` of the last row, the matching
  external anchors, the serializer `schema_version`, and the SHA-256 of each
  file. The manifest is signed with a KMS asymmetric key (ADR-0007) whose public
  key is published.
- A filtered export cannot be chain-verified alone; the manifest says so and the
  full-range export is offered for verification.
- The export requires re-authentication and is itself an `export` event.
- On contract termination, the customer receives a full export before data is
  returned or destroyed under the BAA.

### 7. Timestamps

`occurred_at` is UTC from the database clock. Display converts to the site's
time zone, then the organization's (Florida has Eastern and Central, per
`docs/compliance/florida.md`). Hosts run NTP; clock skew is a monitored metric.

### 8. Retention and legal hold

- **Default retention: 7 years** from the end of the partition's month. This
  exceeds the six-year HIPAA documentation minimum (164.316(b)(2)) with margin
  for the partition boundary and for late-arriving holds. A tenant may configure
  longer, never shorter. `hrsa-regulatory-analyst` and counsel (D3) confirm
  whether any HRSA, FTCA, Florida Medicaid, or public-records (`FL-SUNSHINE`)
  rule requires more, and the catalog carries it as a parameter.
- **Legal hold.** `audit.legal_hold (id, organization_id, scope, from_ts, to_ts,
  reason, set_by, set_at, released_by, released_at)`. Setting and releasing a
  hold are `system` events and require the security officer's approval. A hold
  covers the tenant's whole log for its date range.
- **Retention job.** Monthly, as `audit_retention`:
  1. Choose partitions older than retention.
  2. If **any** tenant in the partition has an active hold overlapping it, move
     the held tenants' rows to a hold partition (`audit_event_hold`) first,
     verifying hashes before and after the copy, then proceed with the rest.
  3. For each tenant, write a **retention checkpoint** event recording the
     last dropped `chain_seq` and its `row_hash`, so later verification starts
     from the checkpoint and is still anchored.
  4. Write an archive copy of the partition to the audit archive bucket (§9)
     only if the tenant's contract asks for it; otherwise detach and drop.
  5. Record `retention.hard_delete` events with counts, range, and the hash of
     the last dropped row.
- Destruction follows FIPA disposal rules (FL-FIPA) and the retention policy
  from Phase 0.

### 9. External anchoring of the chain head

- Every hour, and at the end of every retention or verification run, a job reads
  each tenant's `chain_head` and writes an **anchor record**
  `{organization_id, chain_seq, row_hash, anchored_at}` for all tenants into a
  Merkle tree; the root, the leaves, and a KMS signature are written to an
  **S3 bucket with Object Lock in compliance mode** (retention equal to audit
  retention plus one year), in a **separate AWS account** from production
  (ADR-0005), US region only.
- The daily Merkle root is also sent to an **RFC 3161 trusted timestamp
  authority** under an approved subprocessor; the returned token is stored with
  the anchor. It contains only a hash, so no customer data leaves the platform.
- The anchor id is recorded back into the database (`audit.anchor`) and as a
  `system` event in the platform chain.
- Verification (§2) checks that each anchored `(chain_seq, row_hash)` still
  matches the table. A database-only attacker who rewrites and re-hashes the
  chain cannot also rewrite Object Lock objects or the TSA token.
- Customer exports include inclusion proofs for the anchors in their range.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Separate audit database or event stream (Kafka, then a warehouse) | Loses same-transaction atomicity; needs an outbox and exactly-once handling. Can be added later as a replica fed from this table |
| Managed ledger database (for example Amazon QLDB) | QLDB is discontinued; others add a vendor, a BAA, and a second query language, and do not fit per-tenant RLS |
| Cloud provider audit logs only (CloudTrail, pgAudit) | Capture infrastructure and SQL, not business meaning (who approved which privilege set). pgAudit stays on for DBA activity as a complement |
| One global hash chain | A global lock on every write, and customers could not verify an export without other tenants' hashes |
| Hash computed in the application only | Two writers could disagree; the database function is the single writer, and the TypeScript canonicalizer is kept identical by golden tests |
| Storing full before/after row snapshots | Copies PHI and PII into the log in clear, and makes the log much larger. Source tables already keep version history |
| Digital signature on every row | KMS latency and cost per write; signed anchors give the same tamper evidence at hourly granularity |
| Daily partitions or no partitions | Daily makes too many partitions over 7 years; none makes retention a mass DELETE, which the no-DELETE rule forbids |
| Public blockchain anchoring | Adds a vendor and public exposure for no benefit over Object Lock plus RFC 3161 |
| Retention of exactly 6 years | Partition boundaries and late holds could make a row fall short of six years |

## Consequences

Positive:

- Every G1 audit item has a concrete mechanism and a test.
- Tampering is detectable in the database, against anchors, and by customers
  offline.
- Compliance history is reconstructable: the log plus versioned source tables
  answer "who changed what, when, and why" for any date.
- Retention is cheap (partition drop) and legally defensible (checkpoints,
  holds, audited deletes).

Negative and risks:

- Per-tenant advisory lock serializes writes within a tenant. Expected volume
  is well within limits; bulk imports append in batches inside one lock.
- Two canonicalizers (PL/pgSQL and TypeScript) must stay byte-identical; golden
  tests are mandatory.
- Schema changes to `audit_event` need a new `schema_version` and a new
  serializer, and old serializers are kept forever.
- Moving held rows at retention time is the one place rows are copied; it needs
  its own tests and runbook.
- Object Lock in compliance mode cannot be shortened, even by Loogo Labs; a
  wrong retention setting on the anchor bucket is permanent.
- Anchoring and verification jobs add operational alerts that need an owner
  (`platform-devops-engineer` with `security-privacy-officer`).

Follow-ups:

- `backend-engineer`: audit middleware, action registry, redaction from the
  column registry.
- `security-privacy-officer`: review redaction rules, anchor key custody,
  break-glass logging; add to threat model.
- `qa-test-engineer`: G1 tests listed above, golden canonicalization files,
  tamper test.
- `hrsa-regulatory-analyst` and counsel: confirm retention beyond six years.

## Status

Accepted by the product owner (@jselvalugo) on 2026-09-27. Superseded in part
(names only) by ADR-0011.
