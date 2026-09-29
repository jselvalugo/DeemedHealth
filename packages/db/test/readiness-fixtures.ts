/**
 * Test-only readiness rows, so the tenant-isolation matrix has a row for both seeded
 * tenants in every readiness table (tenant_parameter, readiness_fact, readiness_snapshot).
 * Publishes the synthetic FX-CAT catalog as release 0.0.1 first (the snapshot must point
 * at a release). Written as app_user under RLS; nothing is enqueued, so no recompute ever
 * touches the seeded tenants' instances.
 */
import { compileCatalog } from '@deemed/requirements-catalog/compiler';
import { fxCatSources } from '@deemed/test-fixtures/catalog';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/client.js';

export const SEED_CATALOG_VERSION = '0.0.1';

export async function seedReadinessIsolationRows(
  adminUrl: string,
  tenants: readonly { organizationId: string; userAccountId: string }[],
): Promise<void> {
  const compiled = compileCatalog(fxCatSources(), { catalogVersion: SEED_CATALOG_VERSION });
  if (!compiled.ok || !compiled.nonProduction) throw new Error(compiled.summary.join('\n'));
  const platform = createDatabase({
    connectionString: adminUrl,
    assumeRole: 'app_platform',
    max: 1,
  });
  const user = createDatabase({ connectionString: adminUrl, assumeRole: 'app_user', max: 1 });
  try {
    const releaseId = await platform.withPlatform(
      { type: 'system', label: 'test fixtures' },
      async (tx) => {
        const r = await tx.execute<{ id: string }>(
          sql`SELECT catalog.publish_release(${JSON.stringify(compiled.nonProduction)}::jsonb, 'test fixtures')::text AS id`,
        );
        return r.rows[0]?.id as string;
      },
    );
    for (const t of tenants) {
      // A human actor: health-center parameters are set by people.
      await user.withTenant(
        t.organizationId,
        { type: 'user', label: 'test fixtures', userId: t.userAccountId },
        async (tx) => {
          await tx.execute(sql`
            INSERT INTO public.tenant_parameter (organization_id, requirement_id, parameter_key, value, reason)
            VALUES (${t.organizationId}::uuid, 'TEST-05-PRIV', 'reprivilegingIntervalMonths', 24,
                    'Isolation fixture')`);
        },
      );
      await user.withTenant(
        t.organizationId,
        { type: 'integration', label: 'test fixtures' },
        async (tx) => {
          const inst = await tx.execute<{ id: string }>(
            sql`SELECT id::text FROM public.requirement_instance ORDER BY id LIMIT 1`,
          );
          await tx.execute(sql`
            INSERT INTO public.readiness_fact (organization_id, requirement_instance_id, kind, effective_on,
                                               recorded_by_type)
            VALUES (${t.organizationId}::uuid, ${inst.rows[0]?.id}::uuid, 'document', DATE '2026-01-15',
                    'integration')`);
          await tx.execute(sql`
            INSERT INTO public.readiness_snapshot (organization_id, catalog_release_id, catalog_version,
                                                   engine_version, as_of_date, kind, met, denominator, body)
            VALUES (${t.organizationId}::uuid, ${releaseId}::uuid, ${SEED_CATALOG_VERSION}, '1.0.0',
                    DATE '2026-01-15', 'on_demand', 0, 0, '{"label":"isolation fixture"}'::jsonb)`);
        },
      );
    }
  } finally {
    await Promise.all([platform.close(), user.close()]);
  }
}
