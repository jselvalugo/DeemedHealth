/**
 * The world the generated record route tests run in: the real API on PostgreSQL 16, the
 * two synthetic tenants from the seed, users per role and site scope (signed in once and
 * kept alive), and a maker per record type that writes a synthetic record (from its
 * fixture factory in packages/test-fixtures) at a given place:
 *
 *   'A'    inside the scoped users' site (seeded S1; for `site`, a fixed test site)
 *   'B'    at another site of the same tenant (seeded S3; for `site`, a fresh site)
 *   'new'  a fresh record the org-wide writer may change freely (no blockers)
 *
 * Records are written straight to the database as app_user under RLS (test setup, not
 * an application path); the tests then exercise the API against them.
 */
import { randomUUID } from 'node:crypto';
import { createDatabase, provisionOrganization, type Database } from '@deemed/db';
import {
  COLUMN_CLASSES,
  getRecordType,
  type RecordTypeDef,
  type RecordTypeId,
  type RoleId,
} from '@deemed/domain';
import { sql, type SQL } from 'drizzle-orm';
import { expect } from 'vitest';
import {
  RECORD_FIXTURES,
  type RecordFixture,
} from '../../../packages/test-fixtures/src/records.js';
import { need } from '../../../packages/db/test/helpers.js';
import { tableRef, typed } from '../src/records/rows.js';
import {
  Client,
  auditFor,
  createUser,
  signIn,
  startApi,
  stepUp,
  type TestApi,
  type TestUser,
} from './harness.js';

/** The fixture factory for a record type (packages/test-fixtures). */
function fixture(key: string): RecordFixture {
  const f = RECORD_FIXTURES[key];
  if (!f) throw new Error(`no fixture factory ${key}`);
  return f;
}

export type Tenant = 'xyz' | 'gulf';
export type Place = 'A' | 'B' | 'new';

/** Which roles play which part for each record type. */
export interface TypeRoles {
  reader: RoleId;
  writer: RoleId;
  exporter: RoleId;
  revealer?: RoleId;
  /** No permission on the type at all. */
  denied: RoleId;
}

export const TYPE_ROLES: Record<RecordTypeId, TypeRoles> = {
  // Administration types: the health center administrator (D15) reads and writes them;
  // exports need the compliance officer (org_admin has no admin:export).
  site: {
    reader: 'org_admin',
    writer: 'org_admin',
    exporter: 'compliance_officer',
    denied: 'staff_provider',
  },
  person: {
    reader: 'org_admin',
    writer: 'org_admin',
    exporter: 'compliance_officer',
    revealer: 'compliance_officer',
    denied: 'staff_provider',
  },
  user_account: {
    reader: 'org_admin',
    writer: 'org_admin',
    exporter: 'compliance_officer',
    denied: 'staff_provider',
  },
  role_assignment: {
    reader: 'org_admin',
    writer: 'org_admin',
    exporter: 'compliance_officer',
    denied: 'staff_provider',
  },
  // Compliance data: never the health center administrator (D15).
  requirement_instance: {
    reader: 'compliance_officer',
    writer: 'compliance_officer',
    exporter: 'compliance_officer',
    denied: 'org_admin',
  },
};

export interface World {
  api: TestApi;
  setup: Database;
  /**
   * Two synthetic tenants provisioned for this test file only, so the seeded tenants the
   * db tests count stay untouched: "xyz" with sites S1, S2, S3 and the fixed `site`-type
   * test site, and "gulf" with G1.
   */
  sites: { xyz: { S1: string; S2: string; S3: string; siteA: string }; gulf: { G1: string } };
  org: Record<Tenant, string>;
  /** Plain people of each tenant (owners and subjects). */
  people: Record<Tenant, string[]>;
}

let world: World | undefined;
let seq = 1000;

export function nextSeq(): number {
  seq += 1;
  return seq;
}

const SYSTEM = { type: 'system' as const, label: 'record test setup' };

function testSite(name: string, n: number, timeZone = 'America/New_York') {
  const central = timeZone === 'America/Chicago';
  return {
    id: randomUUID(),
    name,
    form5bSiteId: `TEST-5B-R${n}`,
    addressLine1: `${n} Record Test Way`,
    city: central ? 'Pensacola' : 'Tampa',
    state: 'FL',
    postalCode: central ? '32501' : '33602',
    timeZone,
  };
}

/** A synthetic Florida tenant, provisioned through the platform function like the seed. */
async function provision(label: string, sites: ReturnType<typeof testSite>[]): Promise<string> {
  const platform = createDatabase({
    connectionString: need().adminUrl,
    assumeRole: 'app_platform',
    max: 1,
  });
  try {
    return await platform.withPlatform(SYSTEM, (tx, context) =>
      provisionOrganization(tx, context, {
        legalName: `Records Test Health Center ${label}`,
        awardType: 'section330',
        subPrograms: ['CHC'],
        timeZone: 'America/New_York',
        addressLine1: '1 Record Test Way',
        city: 'Tampa',
        state: 'FL',
        postalCode: '33602',
        isTestRecord: true,
        sites,
      }),
    );
  } finally {
    await platform.close();
  }
}

export async function startWorld(options: Parameters<typeof startApi>[0] = {}): Promise<World> {
  if (world) return world;
  const api = await startApi(options);
  const setup = createDatabase({
    connectionString: need().adminUrl,
    assumeRole: 'app_user',
    max: 2,
  });
  const tag = randomUUID().slice(0, 8);
  const s1 = testSite('Rec S1', 1);
  const s2 = testSite('Rec S2', 2);
  const s3 = testSite('Rec S3', 3, 'America/Chicago');
  const g1 = testSite('Rec G1', 1, 'America/Chicago');
  world = {
    api,
    setup,
    org: {
      xyz: await provision(`${tag} A`, [s1, s2, s3]),
      gulf: await provision(`${tag} B`, [g1]),
    },
    sites: { xyz: { S1: s1.id, S2: s2.id, S3: s3.id, siteA: '' }, gulf: { G1: g1.id } },
    people: { xyz: [], gulf: [] },
  };
  for (const tenant of ['xyz', 'gulf'] as const) {
    for (let i = 0; i < 3; i++) {
      const person = fixture('person')(refs(tenant, null));
      world.people[tenant].push(await insertRecord(tenant, getRecordType('person'), person));
    }
  }
  world.sites.xyz.siteA = await insertRecord(
    'xyz',
    getRecordType('site'),
    fixture('site')(refs('xyz', null)),
  );
  return world;
}

export async function stopWorld(): Promise<void> {
  if (!world) return;
  await world.setup.close();
  await world.api.close();
  world = undefined;
}

export function w(): World {
  if (!world) throw new Error('record test world not started');
  return world;
}

function refs(
  tenant: Tenant,
  siteId: string | null,
  extra: { personId?: string; userAccountId?: string } = {},
) {
  const current = world as World;
  return {
    n: nextSeq(),
    organizationId: current.org[tenant],
    siteId,
    personId: extra.personId ?? current.people[tenant][0] ?? '',
    userAccountId: extra.userAccountId ?? '',
  };
}

/** Inserts one record from field values, as app_user under RLS. Returns its id. */
export async function insertRecord(
  tenant: Tenant,
  def: RecordTypeDef,
  values: Readonly<Record<string, unknown>>,
  extra: Readonly<Record<string, SQL>> = {},
): Promise<string> {
  const current = w();
  const columns: [string, SQL][] = [['organization_id', sql`${current.org[tenant]}::uuid`]];
  for (const [name, v] of Object.entries(values)) {
    const f = def.fields[name];
    if (!f) throw new Error(`${def.id}: fixture field ${name} is not declared`);
    columns.push([f.column, typed(f.kind, v)]);
  }
  if (COLUMN_CLASSES[def.table]?.columns.is_test_record && !('isTestRecord' in values)) {
    columns.push(['is_test_record', sql`true`]);
  }
  for (const [c, v] of Object.entries(extra)) columns.push([c, v]);
  return current.setup.withTenant(current.org[tenant], SYSTEM, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`
      INSERT INTO ${tableRef(def)} (${sql.join(
        columns.map(([c]) => sql.identifier(c)),
        sql`, `,
      )}) VALUES (${sql.join(
        columns.map(([, v]) => v),
        sql`, `,
      )}) RETURNING id::text AS id`);
    return r.rows[0]?.id as string;
  });
}

/** Site id of a place, for the types scoped by a site column or a join. */
export function placeSite(tenant: Tenant, place: Place): string {
  const s = w().sites;
  if (tenant === 'gulf') return s.gulf.G1;
  return place === 'B' ? s.xyz.S3 : s.xyz.S1;
}

/** A person with an account and an active grant at `siteId` (null: no account). */
async function personAt(tenant: Tenant, siteId: string | null) {
  const personId = await insertRecord(
    tenant,
    getRecordType('person'),
    fixture('person')(refs(tenant, null)),
  );
  if (siteId === null) return { personId };
  const userAccountId = await insertRecord(
    tenant,
    getRecordType('user_account'),
    fixture('user_account')(refs(tenant, null, { personId })),
  );
  const grantId = await insertRecord(
    tenant,
    getRecordType('role_assignment'),
    fixture('role_assignment')(refs(tenant, siteId, { userAccountId })),
  );
  return { personId, userAccountId, grantId };
}

/**
 * A record of `typeId` at a place. For `site`, 'A' is the fixed scoped site, and 'B' or
 * 'new' is a fresh site (outside every scoped user's grant).
 */
export async function makeRecord(
  typeId: RecordTypeId,
  place: Place,
  tenant: Tenant = 'xyz',
): Promise<string> {
  const def = getRecordType(typeId);
  switch (typeId) {
    case 'site':
      if (place === 'A' && tenant === 'xyz') return w().sites.xyz.siteA;
      return insertRecord(tenant, def, fixture('site')(refs(tenant, null)));
    case 'person':
      // 'new': no account, so nothing blocks archiving it (organization-wide scope).
      return (await personAt(tenant, place === 'new' ? null : placeSite(tenant, place))).personId;
    case 'user_account':
      return (await personAt(tenant, placeSite(tenant, place))).userAccountId as string;
    case 'role_assignment':
      return (await personAt(tenant, placeSite(tenant, place))).grantId as string;
    case 'requirement_instance':
      return insertRecord(
        tenant,
        def,
        fixture('requirement_instance')(refs(tenant, placeSite(tenant, place))),
      );
  }
}

/** A create payload whose record lands at a place (or is organization-level). */
export function createPayload(
  typeId: RecordTypeId,
  place: Place,
  tenant: Tenant = 'xyz',
): Record<string, unknown> {
  const def = getRecordType(typeId);
  const values = fixture(def.fixture)(
    refs(tenant, typeId === 'requirement_instance' ? placeSite(tenant, place) : null),
  );
  const editable = Object.entries(def.fields)
    .filter(([, f]) => f.editable)
    .map(([n]) => n);
  return Object.fromEntries(editable.filter((k) => k in values).map((k) => [k, values[k]]));
}

/** A valid change for update routes (a field editable after create). */
export function updatePatch(typeId: RecordTypeId): Record<string, unknown> {
  const n = nextSeq();
  switch (typeId) {
    case 'site':
      return { name: `Renamed Synthetic Site ${n}` };
    case 'person':
      return { preferredName: `Fix ${n}` };
    case 'requirement_instance':
      return { ownerPersonId: w().people.xyz[1] as string };
    default:
      throw new Error(`${typeId} has no generic update`);
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface Signed {
  user: TestUser;
  client: Client;
}
const users = new Map<string, Promise<Signed>>();

/** A signed-in user with one grant of `role` (org-wide, or at `siteId`), cached. */
export async function as(
  role: RoleId,
  opts: { tenant?: Tenant; siteId?: string } = {},
): Promise<Client> {
  const tenant = opts.tenant ?? 'xyz';
  const key = `${tenant}:${role}:${opts.siteId ?? '*'}`;
  let entry = users.get(key);
  if (!entry) {
    entry = (async () => {
      const api = w().api;
      const grant = {
        roleId: role,
        ...(opts.siteId ? { siteId: opts.siteId } : {}),
        ...(role === 'auditor' ? { expiresInDays: 14 } : {}),
        ...(role === 'staff_provider' && !opts.siteId ? { siteId: placeSite(tenant, 'A') } : {}),
      };
      const user = await createUser(api, { organizationId: w().org[tenant] }, [grant]);
      return { user, client: await signIn(api, user) };
    })();
    users.set(key, entry);
  }
  const s = await entry;
  // Keep the session alive across fake-clock moves; sign in again if it ended.
  const me = await s.client.get('/api/me');
  if (me.statusCode === 200) s.client.csrf = me.json().csrfToken;
  else s.client = await signIn(w().api, s.user);
  return s.client;
}

/** Step-up for routes that need re-authentication within 5 minutes. */
export async function fresh(
  role: RoleId,
  opts: { tenant?: Tenant; siteId?: string } = {},
): Promise<Client> {
  const client = await as(role, opts);
  const tenant = opts.tenant ?? 'xyz';
  const entry = users.get(`${tenant}:${role}:${opts.siteId ?? '*'}`);
  if (!entry) throw new Error('user not signed in');
  const s = await entry;
  await stepUp(w().api, s.user, client);
  return client;
}

/** The scoped site for a type: the fixed test site for `site`, S1 otherwise. */
export function scopedSite(typeId: RecordTypeId): string {
  return typeId === 'site' ? w().sites.xyz.siteA : w().sites.xyz.S1;
}

/** Row version of a record, read as the database owner (test assertion only). */
export async function versionOf(def: RecordTypeDef, id: string): Promise<number> {
  const r = await w().api.admin.query<{ v: number }>(
    `SELECT row_version AS v FROM ${def.table} WHERE id = $1`,
    [id],
  );
  return r.rows[0]?.v as number;
}

/** Every id of a list, following the cursor. */
export async function listAll(client: Client, url: string, max = 50): Promise<string[]> {
  const ids: string[] = [];
  let next: string | null = null;
  for (let page = 0; page < max; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await client.get(
      next ? `${url}${sep}limit=200&cursor=${encodeURIComponent(next)}` : `${url}${sep}limit=200`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: { id: string }[]; nextCursor: string | null };
    ids.push(...body.items.map((i) => i.id));
    next = body.nextCursor;
    if (!next) return ids;
  }
  throw new Error('list did not end');
}

export async function eventsFor(res: Parameters<typeof auditFor>[1]) {
  return auditFor(w().api, res);
}
