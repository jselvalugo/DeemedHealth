# ADR-0004: AI gateway and guardrails

- Status: **Proposed** (only the product owner, @jselvalugo, accepts; roadmap D5)
- Date: 2026-09-27
- Owner: `suite-architect`; reviewers `ai-assistant-engineer`, `security-privacy-officer`
- Related: ADR-0001, ADR-0002, ADR-0003, ADR-0005, ADR-0007, ADR-0008; roadmap §2 rules 4–7, §9 (Phase 6), D1, D3; `docs/compliance/florida.md` FL-PRIV-3

## Context

The Deemed Assistant (briefs, document intake, assistant panel) uses the
Claude API. Principle 2: AI guides, humans decide; it never attests, approves,
signs, submits, clears a match, grants privileges, or closes a finding.
Principle 3: every AI answer cites its source. Tenants hold staff/board PII and
limited PHI. Roadmap D1 bans SSNs. Florida-only operation assumes all
subprocessors, including the AI provider, process data in the US
(FL-PRIV-3, subject to counsel). The AI provider is a subprocessor and
must be under a BAA before any customer data reaches it.

## Decision

1. **Single server-side gateway.** All model calls go through
   `packages/ai-gateway`, used only by `apps/api` and `apps/worker`. Browsers
   never call the provider and never see API keys. A lint rule and egress
   allowlist block any other route to the provider.
2. **Provider, BAA, and US-only processing.** The provider is Anthropic's
   Claude API (latest Claude model, pinned per capability and changed only
   after evals pass). Before any customer data is sent:
   - a **BAA with the AI provider** is signed and listed in
     `docs/security/subprocessors.md`;
   - the account is configured for **US-only data processing/inference**
     and the contract confirms it; if US-only processing cannot be guaranteed
     on the direct API, the gateway uses a HIPAA-eligible US-region cloud
     deployment of Claude instead (decided with ADR-0005);
   - **zero data retention** (or the shortest available) and no training on
     customer data are contractually confirmed.
   Until all three hold, the gateway runs in **synthetic-only mode**: it
   refuses requests from production tenants (configuration-enforced, tested).
3. **Per-tenant switch.** AI is off by default per tenant and per capability;
   the tenant admin enables it. Every call is attributed to tenant, actor, and
   capability.
4. **Data minimization and masking (pre-send redaction pipeline).**
   - **No SSN, ever (D1).** SSN-shaped strings (`\d{3}-?\d{2}-?\d{4}` and
     variants) are detected; the request is **blocked** (not merely masked)
     and an audit event is written. The same detector runs on document intake
     before OCR text is stored.
   - **Masked by default:** DOB, DEA number, home address, phone, personal
     email, license and NPI numbers when not needed for the task, and all
     PHI fields; they are replaced with stable placeholders
     (`[PERSON_1]`, `[DOB_1]`) and re-hydrated server-side only in the output
     the user is entitled to see.
   - Each capability declares an **allowlist of fields** it may send; anything
     else is dropped. Field classifications come from the data dictionary.
   - Incident and grievance narratives (PHI) are excluded from AI until a
     capability-specific review by `security-privacy-officer` approves them.
5. **Tenant isolation.** Retrieval context is loaded through `withTenant`
   (ADR-0002); prompts never mix tenants. No cross-tenant caches of prompts or
   embeddings; any vector index is tenant-partitioned under RLS.
6. **Grounding and citations.** Answers are grounded in the tenant's records
   and **verified catalog entries only** (ADR-0003); drafts are never passed
   to the model in production. Every answer shows the `requirementId`s and
   source citations with "last verified" dates; an answer without a supporting
   citation is shown as "I can't confirm this" rather than asserted.
7. **Output guardrails.**
   - Tools the model may call are read-only or **draft-producing** (draft a
     task, a memo, a checklist). No tool can approve, attest, sign, submit,
     clear a screening match, grant privileges, close a finding, or change a
     `RequirementInstance` status. Those actions require a human through the
     normal `Approval` flow.
   - Output is labeled "AI draft"; readiness wording never implies an HRSA
     determination (roadmap §2 rule 5).
   - Prompt-injection defense: uploaded documents and retrieved text are
     passed as clearly delimited untrusted data; instructions inside them are
     ignored; tool calls are validated against schema and the user's RBAC.
   - Output is scanned for SSN-shaped values and unmasked fields before
     display.
8. **Logging and audit.** Each call writes an `AuditEvent` (tenant, actor,
   capability, model, catalog version, token counts, redaction summary,
   outcome). Prompts and responses are stored only in redacted form, encrypted
   (ADR-0007), with a retention period set in the retention policy.
9. **Evals gate release.** Each capability ships only after an eval suite on
   synthetic fixtures passes (accuracy, citation presence, refusal of
   prohibited actions, SSN block, injection resistance), per roadmap §9.
10. **Operational limits.** Per-tenant rate limits and budgets, timeouts,
    and graceful fallback ("assistant unavailable"); the product works fully
    without AI.

## Alternatives considered

- **Client-side calls to the provider.** Exposes keys and bypasses redaction.
- **Self-hosted open model.** Avoids a subprocessor but adds GPU hosting,
  weaker quality, and our own security burden; not justified now.
- **Mask SSNs instead of blocking.** D1 forbids collecting SSNs at all;
  blocking surfaces the problem instead of quietly storing a partial value.
- **Allow AI to complete low-risk approvals.** Violates principle 2 and roadmap
  §2 rule 4.

## Consequences

- AI features cannot reach a customer until the AI provider BAA, US-only
  processing, and retention terms are confirmed (and counsel answers
  FL-PRIV-3); Phase 6 is gated on this.
- The redaction pipeline and SSN detector are shared code with document
  intake and are owned jointly by `ai-assistant-engineer` and
  `security-privacy-officer`.
- Some answers are less specific because of masking; accepted.
- Model upgrades require a re-run of evals and are recorded in the audit log.

## Status

Proposed. Awaiting acceptance by the product owner (@jselvalugo).
