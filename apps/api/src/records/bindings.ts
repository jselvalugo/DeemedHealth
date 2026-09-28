/**
 * Database binding of each record type (ADR-0014 section 1): the SQL behind its site
 * scope, its `own` rule, its archive blockers, and its create-time checks. Declarations
 * stay pure in packages/domain; only this file knows the joins.
 *
 * Every expression is written against the alias `t` for the bound table and runs inside
 * `withTenant`, so RLS limits every table it touches to the caller's organization.
 * Hooks run inside the framework's transaction and cannot open another one, skip the
 * audit middleware, or call withPlatform.
 */
import type { Tx } from '@deemed/db';
import type { ArchiveBlocker, RecordTypeId, SiteScopeJoin } from '@deemed/domain';
import { sql, type SQL } from 'drizzle-orm';

/** `a IN (...)` over validated UUIDs; an empty list matches nothing. */
export function uuidIn(expr: SQL, ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`FALSE`;
  return sql`${expr} IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

/**
 * An active grant, with exactly the rules of the policy engine (`grantInactiveReason` in
 * packages/domain/src/policy/policy.ts): not revoked by `now`, started, not expired, and
 * for an end-dated role (auditor) an end date within the role's maximum. Grants of an
 * archived or deprovisioned account count for nothing. `now` is the API clock, the same
 * instant the policy engine uses. Aliases: `ra` grant, `r` role, `ua` account.
 */
function activeGrant(now: string): SQL {
  return sql`(ra.revoked_at IS NULL OR ra.revoked_at > ${now}::timestamptz)
    AND ra.valid_from <= ${now}::timestamptz
    AND (ra.expires_at IS NULL OR ra.expires_at > ${now}::timestamptz)
    AND (NOT r.requires_expiry
         OR (ra.expires_at IS NOT NULL AND ra.expires_at - ra.valid_from <= r.max_duration))
    AND ua.archived_at IS NULL AND ua.status <> 'deprovisioned'`;
}

const GRANTS = sql`public.role_assignment ra
  JOIN public.role r ON r.key = ra.role_key
  JOIN public.user_account ua ON ua.organization_id = ra.organization_id AND ua.id = ra.user_account_id`;

export interface SiteJoin {
  /** text[] of the record's site ids. */
  sites(now: string): SQL;
  /** The record has at least one of these sites. */
  siteIn(ids: readonly string[], now: string): SQL;
  /**
   * The record is organization-wide: it has no site, or an organization-wide grant (a
   * grant with no site). Changing it then needs an organization-wide grant, whatever
   * site grants it also has.
   */
  orgWide(now: string): SQL;
}

/** The grants that belong to the record at `t`. */
function siteJoin(owner: SQL): SiteJoin {
  const grants = (now: string, extra: SQL) =>
    sql`SELECT 1 FROM ${GRANTS} WHERE ${owner} AND ${activeGrant(now)} AND ${extra}`;
  return {
    sites: (now) =>
      sql`ARRAY(SELECT DISTINCT ra.site_id::text FROM ${GRANTS}
                WHERE ${owner} AND ${activeGrant(now)} AND ra.site_id IS NOT NULL)`,
    siteIn: (ids, now) => sql`EXISTS (${grants(now, uuidIn(sql`ra.site_id`, ids))})`,
    orgWide: (now) =>
      sql`(EXISTS (${grants(now, sql`ra.site_id IS NULL`)})
           OR NOT EXISTS (${grants(now, sql`ra.site_id IS NOT NULL`)}))`,
  };
}

/** Named joins for records linked to several sites (a person working at two sites). */
export const SITE_JOINS: Record<SiteScopeJoin, SiteJoin> = {
  // A person's sites: the sites of the active grants of their live user accounts.
  person_sites: siteJoin(sql`ua.person_id = t.id`),
  // A user account's sites: the sites of its own active grants (none if it is not live).
  user_account_sites: siteJoin(sql`ua.id = t.id`),
};

/** Archive is refused while one of these exists (ADR-0014 section 2.4). */
export const ARCHIVE_BLOCKER_SQL: Record<ArchiveBlocker, SQL> = {
  active_user_account: sql`EXISTS (SELECT 1 FROM public.user_account ua
                                   WHERE ua.person_id = t.id AND ua.archived_at IS NULL)`,
  active_role_assignment: sql`EXISTS (SELECT 1 FROM public.role_assignment ra
                                      WHERE ra.site_id = t.id AND ra.revoked_at IS NULL)`,
  active_requirement_instance: sql`EXISTS (SELECT 1 FROM public.requirement_instance ri
                                           WHERE ri.site_id = t.id AND ri.archived_at IS NULL)`,
};

export interface OwnRule {
  /** The record is about or assigned to the person. */
  predicate(personId: string): SQL;
  /** uuid text[] of the people the record is about or assigned to. */
  owners: SQL;
}

export interface RecordBinding {
  own?: OwnRule;
  /**
   * Referential checks on a new or changed record, in the request transaction; returns
   * the paths of invalid fields. References must exist in this organization (RLS hides
   * other tenants' rows, so another tenant's id fails here, never leaks).
   */
  validate?(tx: Tx, record: Readonly<Record<string, unknown>>): Promise<string[]>;
  /** Columns set by the system on create (never from the payload). */
  createDefaults?: Readonly<Record<string, string | boolean | null>>;
}

async function exists(tx: Tx, query: SQL): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`SELECT EXISTS (${query}) AS ok`);
  return r.rows[0]?.ok === true;
}

const siteExists = (tx: Tx, id: unknown) =>
  typeof id === 'string'
    ? exists(tx, sql`SELECT 1 FROM public.site WHERE id = ${id}::uuid`)
    : Promise.resolve(true);

const personExists = (tx: Tx, id: unknown) =>
  typeof id === 'string'
    ? exists(tx, sql`SELECT 1 FROM public.person WHERE id = ${id}::uuid`)
    : Promise.resolve(true);

/**
 * One binding per registered record type (the type makes a missing one a compile error;
 * the registry lists the rest).
 */
export const RECORD_BINDINGS: Record<RecordTypeId, RecordBinding> = {
  site: { createDefaults: { state: 'FL' } },
  person: {},
  user_account: {},
  role_assignment: {},
  requirement_instance: {
    own: {
      predicate: (personId) =>
        sql`(t.owner_person_id = ${personId}::uuid
             OR (t.subject_type = 'person' AND t.subject_id = ${personId}::uuid))`,
      owners: sql`array_remove(ARRAY[t.owner_person_id::text,
                  CASE WHEN t.subject_type = 'person' THEN t.subject_id::text END], NULL)`,
    },
    async validate(tx, r) {
      const bad: string[] = [];
      if (!(await siteExists(tx, r.siteId))) bad.push('siteId');
      if (!(await personExists(tx, r.ownerPersonId))) bad.push('ownerPersonId');
      if (r.subjectType === 'person' && !(await personExists(tx, r.subjectId))) {
        bad.push('subjectId');
      }
      if (r.subjectType === 'site' && !(await siteExists(tx, r.subjectId))) bad.push('subjectId');
      return bad;
    },
  },
};
