/**
 * Test world for the readiness service and jobs (db project): two synthetic Florida
 * tenants provisioned for the calling file only (the seeded tenants are never recomputed),
 * each with an Eastern and a Central site, a person, a human user, and instances of the
 * FX-CAT fixture requirements. Connections log in as the runtime roles.
 */
import { randomUUID } from 'node:crypto';
import { createDatabase, provisionOrganization, type Actor, type Database } from '@deemed/db';
import { compileCatalog, type CatalogBundle } from '@deemed/requirements-catalog/compiler';
import { fxCatSources } from '@deemed/test-fixtures/catalog';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { connect, need } from '../../db/test/helpers.js';

export const SYSTEM: Actor = { type: 'system', label: 'readiness test setup' };

export interface TestOrg {
  id: string;
  siteE: string;
  siteC: string;
  personE: string;
  personC: string;
  userId: string;
  instances: {
    licenseE: string;
    licenseC: string;
    deaE: string;
    priv: string;
    budget: string;
    meetings: string;
    procedures: string;
  };
}

export interface World {
  admin: pg.Client;
  /** app_user login (RLS applies). */
  tenant: Database;
  /** app_platform login. */
  platform: Database;
  a: TestOrg;
  b: TestOrg;
  human(org: TestOrg): Actor;
  close(): Promise<void>;
}

let n = 0;
function site(name: string, central: boolean) {
  n += 1;
  return {
    id: randomUUID(),
    name,
    form5bSiteId: `TEST-5B-RD${n}-${randomUUID().slice(0, 4)}`,
    addressLine1: `${n} Readiness Test Way`,
    city: central ? 'Pensacola' : 'Tampa',
    state: 'FL',
    postalCode: central ? '32501' : '33602',
    timeZone: central ? 'America/Chicago' : 'America/New_York',
  };
}

async function makeOrg(platform: Database, tenant: Database, label: string): Promise<TestOrg> {
  const e = site(`${label} East`, false);
  const c = site(`${label} Panhandle`, true);
  const id = await platform.withPlatform(SYSTEM, (tx, context) =>
    provisionOrganization(tx, context, {
      legalName: `Readiness Test Health Center ${label}`,
      awardType: 'section330',
      subPrograms: ['CHC'],
      timeZone: 'America/New_York',
      addressLine1: '1 Readiness Test Way',
      city: 'Tampa',
      state: 'FL',
      postalCode: '33602',
      isTestRecord: true,
      sites: [e, c],
    }),
  );
  return tenant.withTenant(id, SYSTEM, async (tx) => {
    const person = async (given: string) =>
      (
        await tx.execute<{ id: string }>(sql`
          INSERT INTO public.person (organization_id, given_name, family_name, is_test_record)
          VALUES (${id}::uuid, ${given}, 'Synthetic', true) RETURNING id::text`)
      ).rows[0]?.id as string;
    const personE = await person('Eastern');
    const personC = await person('Central');
    const userId = (
      await tx.execute<{ id: string }>(sql`
        INSERT INTO public.user_account (organization_id, person_id, idp_issuer, idp_subject, login_email, status, is_test_record)
        VALUES (${id}::uuid, ${personE}::uuid, 'local', ${randomUUID()},
                ${`readiness.${randomUUID().slice(0, 8)}@readiness-test.example`}, 'active', true)
        RETURNING id::text`)
    ).rows[0]?.id as string;
    const inst = async (
      requirementId: string,
      subject: 'person' | 'organization',
      subjectId: string,
      siteId: string | null,
    ) =>
      (
        await tx.execute<{ id: string }>(sql`
          INSERT INTO public.requirement_instance (organization_id, requirement_id, subject_type, subject_id, site_id)
          VALUES (${id}::uuid, ${requirementId}, ${subject}, ${subjectId}::uuid, ${siteId}::uuid)
          RETURNING id::text`)
      ).rows[0]?.id as string;
    return {
      id,
      siteE: e.id,
      siteC: c.id,
      personE,
      personC,
      userId,
      instances: {
        licenseE: await inst('TEST-05-LICENSE', 'person', personE, e.id),
        licenseC: await inst('TEST-05-LICENSE', 'person', personC, c.id),
        deaE: await inst('TEST-05-DEA', 'person', personE, e.id),
        priv: await inst('TEST-05-PRIV', 'person', personE, e.id),
        budget: await inst('TEST-19-BUDGET', 'organization', id, null),
        meetings: await inst('TEST-19-MEETINGS', 'organization', id, null),
        procedures: await inst('TEST-05-PROCEDURES', 'organization', id, null),
      },
    };
  });
}

export async function startWorld(): Promise<World> {
  const c = need();
  const admin = await connect(c.adminUrl);
  const tenant = createDatabase({ connectionString: c.appUserUrl, max: 3 });
  const platform = createDatabase({ connectionString: c.platformUrl, max: 2 });
  const tag = randomUUID().slice(0, 6);
  const a = await makeOrg(platform, tenant, `${tag} A`);
  const b = await makeOrg(platform, tenant, `${tag} B`);
  return {
    admin,
    tenant,
    platform,
    a,
    b,
    human: (org) => ({ type: 'user', label: 'Synthetic Compliance Officer', userId: org.userId }),
    close: async () => {
      await Promise.all([admin.end(), tenant.close(), platform.close()]);
    },
  };
}

/** The next catalog version after every release in the database (releases are global). */
export async function nextCatalogVersion(admin: pg.Client): Promise<string> {
  const r = await admin.query<{ v: string | null }>(
    `SELECT catalog_version AS v FROM catalog.catalog_release
     ORDER BY string_to_array(catalog_version, '.')::int[] DESC LIMIT 1`,
  );
  const [major = 0, minor = 0] = (r.rows[0]?.v ?? '0.0.0').split('.').map(Number);
  return `${Math.max(major, 1)}.${minor + 1}.0`;
}

/** Compiles the FX-CAT fixtures (or the given raw entries) at a version. */
export function fxBundles(
  catalogVersion: string,
  entries?: Record<string, unknown>[],
): { nonProduction: CatalogBundle; production: CatalogBundle } {
  const r = compileCatalog(fxCatSources(entries), { catalogVersion });
  if (!r.ok || !r.nonProduction || !r.production) throw new Error(r.summary.join('\n'));
  return { nonProduction: r.nonProduction, production: r.production };
}

/** The PostgreSQL error a promise rejects with (drizzle may wrap it in `cause`). */
export async function pgError(
  promise: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as {
      code?: string;
      message: string;
      cause?: { code?: string; message: string };
    };
    if (typeof e.code === 'string') return { code: e.code, message: e.message };
    if (e.cause && typeof e.cause.code === 'string')
      return { code: e.cause.code, message: e.cause.message };
    throw error;
  }
  throw new Error('expected a PostgreSQL error, but the statement succeeded');
}
