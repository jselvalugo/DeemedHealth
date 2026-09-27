# ADR-0006: Identity — SSO, MFA, sessions, SCIM, break-glass

> **Draft — requires signature by the product owner/security officer.** Prepared by `security-privacy-officer` on 2026-09-27. Not in force until signed. Regulatory citations are planning assumptions to verify against the current source.

**Status:** Accepted (@jselvalugo, 2026-09-27; roadmap D5)
**Owner:** `security-privacy-officer` · **Decider:** product owner (@jselvalugo, roadmap D5)
**Depends on:** ADR-0001 (stack), ADR-0002 (tenancy), ADR-0005 (hosting), ADR-0008 (audit)

## Context
Deemed Health holds staff, provider, and board PII and limited PHI (FTCA incidents,
later grievances). HIPAA requires unique user identification, person or entity
authentication, automatic logoff, and access control (45 CFR 164.312(a)(2)(i),
164.312(a)(2)(iii), 164.312(d)). Health centers typically run Microsoft Entra ID
or Google Workspace. Some small centers have no IdP. Board members are often
outside the center's directory.

## Decision
1. **Federation first.** Each tenant configures one or more IdPs over **OIDC**
   (preferred) or **SAML 2.0**. SP-initiated login only; IdP-initiated SAML is off
   by default. Assertions must be signed; SAML responses encrypted where the IdP
   supports it. Accepted clock skew 2 minutes; replay cache on assertion IDs.
2. **Fallback local accounts** only for tenants without an IdP and for board
   members/auditors outside the directory: email + password (min 12 chars,
   breached-password check, no forced periodic rotation) plus MFA.
3. **MFA required for every role, no exceptions.** For federated users we require
   the IdP to assert MFA (`amr`/`acr` for OIDC, `AuthnContextClassRef` for SAML);
   if it does not, we step up with our own MFA. Allowed factors: WebAuthn/passkeys
   (preferred, phishing-resistant), TOTP. **SMS and email OTP are not allowed.**
   Compliance officer and Administration roles must use WebAuthn by G4.
4. **Sessions.** Server-side sessions, opaque cookie (`HttpOnly`, `Secure`,
   `SameSite=Lax`, host-prefixed). Idle timeout **15 minutes** (tenant may shorten,
   not lengthen); absolute lifetime **12 hours**. Session rotated on login and on
   privilege change. Sessions are bound to one tenant; switching tenants is a new
   session.
5. **Re-authentication (step-up)** within the last **5 minutes** is required for:
   revealing a masked sensitive field, any export, approvals/attestation records,
   role/permission/site-scope changes, IdP/SCIM configuration, integration
   credentials, and audit-log export.
6. **Provisioning.** SCIM 2.0 endpoint per tenant (bearer token, rotated, scoped
   to the tenant). Deprovision (`active=false` or delete) revokes all sessions and
   API tokens within **60 seconds**. JIT provisioning from the IdP is allowed but
   creates users with **no role**; a tenant admin assigns roles (deny by default).
7. **Authorization inputs.** Roles from `docs/product/module-map.md`, site scope,
   and record rules are held in Deemed Health, not taken from IdP group claims
   unless the tenant maps groups explicitly. Auditor access requires an end date
   (max 30 days, renewable) and expires automatically.
8. **Loogo Labs workforce access to tenant data** is off by default. Support uses
   a customer-granted, time-boxed, audited access grant. No standing access.
9. **Break-glass.** Two sealed break-glass admin accounts per environment for the
   platform (not per tenant), hardware-key MFA, credentials held by the product
   owner and the security officer. Any use pages on-call, is audited, and is
   reviewed within one business day.
10. **Audit.** Login success/failure, MFA enrollment/reset, step-up, session
    revocation, SCIM events, role changes, and break-glass use go to the audit
    log (ADR-0008). No passwords, tokens, or assertions in application logs.
11. **Abuse controls.** Per-account and per-IP rate limits, progressive lockout,
    generic error messages (no user enumeration), MFA reset only through tenant
    admin with step-up plus a notification to the user.

## Alternatives considered
- **Build auth in-house end to end:** rejected; high risk, slow. We use a
  maintained identity library or a HIPAA-eligible identity provider under a BAA
  (vendor chosen in ADR-0005 or an amendment; recorded in `subprocessors.md`).
- **SMS OTP:** rejected (SIM swap, phishing).
- **Trust IdP group claims for roles:** rejected as default; misconfigured groups
  would over-grant.
- **Longer idle timeout (30–60 min):** rejected for PHI-bearing screens; can
  revisit per-module with evidence.

## Consequences
- Tenant onboarding must include IdP setup and an MFA-assertion test.
- Board members without directory accounts need the local-account path.
- Step-up adds friction to exports and reveals; this is intended.
- The identity vendor (if any) becomes a subprocessor and needs a BAA if it
  stores PHI-adjacent data (it stores PII: names, emails).

## Open items
- Identity vendor vs. library choice (with ADR-0001/0005).
- Confirm idle-timeout values with pilot customers' own policies.
- **Shared rate-limit store before production scales out.** The API's request rate
  limits (global per client and tighter on sign-in steps, keyed by IPv4 address or
  IPv6 /64) count in each process's memory. A shared store (for example Redis) is
  required before production runs more than one API task, or each task grants its
  own budget. Sign-in throttling and lockout do not depend on it: they live in
  PostgreSQL (`platform.auth_throttle`, on the database clock). Tracked in the Phase 1
  plan, S9.
