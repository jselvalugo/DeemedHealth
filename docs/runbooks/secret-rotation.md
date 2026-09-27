# Runbook: secret rotation

Owner: `platform-devops-engineer`. Reviewed with `security-privacy-officer`.
Related: ADR-0005 §6 (secrets), ADR-0007 (keys), ADR-0009 (Netlify, non-production).

## Where secrets live

| Environment | Store | Allowed contents |
| --- | --- | --- |
| local | Uncommitted `.env.local` (gitignored) | Sandbox and stub values only |
| Netlify (preview, branch, development) | Netlify environment variables, scoped per context | Sandbox credentials only. Never production secrets |
| AWS non-production | AWS Secrets Manager in `dh-nonprod`, `/dh/{env}/...` | Sandbox credentials |
| production | AWS Secrets Manager in `dh-prod`, `/dh/production/...` | Real credentials |

Never put a secret in the repository, a CI log, a container image, a client
bundle, or any `NEXT_PUBLIC_*` variable.

## Schedule

| Secret | Cadence |
| --- | --- |
| Production database credentials | Automatic, every 30 days (Secrets Manager rotation) |
| Third-party API keys (screening sources, email, SMS, AI) | Every 90 days, and on any staff departure with access |
| Netlify sandbox variables | Every 90 days |
| Anything suspected exposed | Immediately (see "Emergency rotation") |

## Planned rotation (third-party API key)

1. Open a change ticket naming the secret, environment, and owner. Do not paste the value.
2. Create the new key in the vendor console (sandbox for non-production). Keep the old one active.
3. Store the new value:
   - AWS: `aws secretsmanager put-secret-value --secret-id /dh/{env}/{name}` from a
     just-in-time session (production requires the approved role).
   - Netlify: Site configuration, Environment variables, edit the value for the
     affected contexts only.
4. Roll the workloads so they read the new value (ECS service redeploy, or a
   Netlify redeploy with "Clear cache and deploy").
5. Verify: health check green, one sandbox (or production) call succeeds, no auth errors in logs.
6. Revoke the old key in the vendor console.
7. Record the date, secret name (not value), and operator in the ticket.

## Emergency rotation (suspected exposure)

1. Revoke the exposed secret at the source first, accepting downtime.
2. Issue and store a replacement (steps 2 to 5 above).
3. If the secret was in git: rotate first, then purge history only if required;
   treat the value as public regardless.
4. Check access logs for use of the old secret since the exposure window started.
5. Open a security incident with `security-privacy-officer`. If production
   data could have been reached, follow the breach assessment process.

## Rollback

Keep the previous key active until step 5 passes. If verification fails, restore
the previous value in the store and redeploy, then investigate before retrying.

## Alerts

- Secrets Manager rotation failure (CloudWatch/EventBridge) pages the on-call.
- gitleaks and GitHub secret scanning findings block the PR and notify the owner.
