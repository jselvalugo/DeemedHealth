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

/** Active grants of a user account (the account's sites). */
const ACTIVE_GRANT = sql`ra.revoked_at IS NULL AND ra.site_id IS NOT NULL`;

export interface SiteJoin {
  /** text[] of the record's site ids (empty = organization-wide). */
  sites: SQL;
  /** The record has at least one of these sites. */
  siteIn(ids: readonly string[]): SQL;
}

/** Named joins for records linked to several sites (a person working at two sites). */
export const SITE_JOINS: Record<SiteScopeJoin, SiteJoin> = {
  // A person's sites: the sites of the active role grants of their user accounts.
  person_sites: {
    sites: sql`ARRAY(SELECT DISTINCT ra.site_id::text
                     FROM public.user_account ua
                     JOIN public.role_assignment ra
                       ON ra.organization_id = ua.organization_id AND ra.user_account_id = ua.id
                     WHERE ua.person_id = t.id AND ${ACTIVE_GRANT})`,
    siteIn: (ids) =>
      sql`EXISTS (SELECT 1 FROM public.user_account ua
                  JOIN public.role_assignment ra
                    ON ra.organization_id = ua.organization_id AND ra.user_account_id = ua.id
                  WHERE ua.person_id = t.id AND ra.revoked_at IS NULL
                    AND ${uuidIn(sql`ra.site_id`, ids)})`,
  },
  // A user account's sites: the sites of its own active role grants.
  user_account_sites: {
    sites: sql`ARRAY(SELECT DISTINCT ra.site_id::text FROM public.role_assignment ra
                     WHERE ra.user_account_id = t.id AND ${ACTIVE_GRANT})`,
    siteIn: (ids) =>
      sql`EXISTS (SELECT 1 FROM public.role_assignment ra
                  WHERE ra.user_account_id = t.id AND ra.revoked_at IS NULL
                    AND ${uuidIn(sql`ra.site_id`, ids)})`,
  },
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
