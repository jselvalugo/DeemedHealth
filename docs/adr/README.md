# Architecture Decision Records

Owner: `suite-architect`. File name pattern: `NNNN-kebab-title.md`.

Every ADR has these sections: **Context**, **Decision**, **Alternatives considered**,
**Consequences**, and **Status** (Proposed / Accepted / Superseded by NNNN).

Planned first records:
- `0001-stack-and-repo-layout.md`: confirm the stack proposed in `CLAUDE.md`
- `0002-tenancy-and-row-level-security.md`
- `0003-requirements-catalog-versioning.md`
- `0004-ai-gateway-and-guardrails.md`
- `0005-hosting-environments-and-regions.md`
- `0006-identity-sso-mfa.md`
- `0007-encryption-and-key-management.md`
- `0008-audit-log.md`
- `0009-netlify-for-development-environments.md` (Accepted; amends 0005 for non-production)
- `0010-development-runtime-on-netlify.md` (Proposed; API, database, jobs, storage, and auth for the Netlify development environment)
- `0011-tenancy-naming.md` (Accepted; `organization_id`, `app.organization_id`, and the database roles; supersedes 0002 and 0008 in part)
- `0012-platform-operator-console.md` (Proposed; Loogo Labs operator console and customer-approved support access)
- `0013-environment-management.md` (Proposed; environment matrix, typed config, flags, migrations, promotion)

All eight must be Accepted before gate G0 in `docs/product/implementation-roadmap.md`.
