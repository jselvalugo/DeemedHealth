/**
 * Test-only identity rows, so the tenant-isolation matrix has a row for both tenants in
 * every auth table (factor, pending sign-in, session). Written through the runtime role
 * and RLS like the application would, with a synthetic encrypted blob and random token
 * digests. Real sign-ins in the API tests create their own rows.
 */
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../src/client.js';
import * as schema from '../src/schema/index.js';

export async function seedAuthIsolationRows(
  adminUrl: string,
  tenants: readonly { organizationId: string; userAccountId: string }[],
): Promise<void> {
  const database = createDatabase({ connectionString: adminUrl, assumeRole: 'app_user', max: 1 });
  const now = new Date();
  try {
    for (const t of tenants) {
      await database.withTenant(
        t.organizationId,
        { type: 'system', label: 'test fixtures' },
        async (tx) => {
          const [factor] = await tx
            .insert(schema.authFactor)
            .values({
              organizationId: t.organizationId,
              userAccountId: t.userAccountId,
              kind: 'totp',
              label: 'Isolation fixture',
              totpSecretEnc: randomBytes(48),
              verifiedAt: now,
            })
            .returning({ id: schema.authFactor.id });
          await tx.insert(schema.enrollmentToken).values({
            organizationId: t.organizationId,
            userAccountId: t.userAccountId,
            tokenHash: randomBytes(32),
            purpose: 'invite',
            createdAt: now,
            expiresAt: new Date(now.getTime() + 3_600_000),
            revokedAt: now,
          });
          await tx.insert(schema.loginAttempt).values({
            organizationId: t.organizationId,
            userAccountId: t.userAccountId,
            tokenHash: randomBytes(32),
            createdAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
            passwordVerifiedAt: now,
            consumedAt: now,
          });
          await tx.insert(schema.session).values({
            organizationId: t.organizationId,
            userAccountId: t.userAccountId,
            tokenHash: randomBytes(32),
            issuedAt: now,
            lastSeenAt: now,
            absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
            mfaMethod: 'totp',
            mfaFactorId: (factor as { id: string }).id,
            mfaAt: now,
            reauthAt: now,
            revokedAt: now,
            revokeReason: 'logout',
          });
        },
      );
    }
  } finally {
    await database.close();
  }
}
