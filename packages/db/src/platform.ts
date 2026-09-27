/**
 * Platform operations for app_platform (ADR-0002 sections 3, 8, 9). Run inside
 * withPlatform(). Each helper calls one reviewed SECURITY DEFINER function.
 */
import { sql } from 'drizzle-orm';
import type { TransactionContext, Tx } from './client.js';
import type { AwardType, FloridaTimeZone, SITE_TYPES, SubProgram } from './schema/core.js';

export interface ProvisionSiteInput {
  id?: string;
  name: string;
  form5bSiteId?: string;
  siteType?: (typeof SITE_TYPES)[number];
  addressLine1: string;
  addressLine2?: string;
  city: string;
  /** Must be FL (decision D4). Typed as string so the database check is what decides. */
  state: string;
  postalCode: string;
  timeZone: FloridaTimeZone | (string & {});
  validFrom?: string;
}

export interface ProvisionOrganizationInput {
  id?: string;
  legalName: string;
  awardType: AwardType;
  subPrograms: readonly SubProgram[];
  grantNumber?: string;
  npi?: string;
  timeZone: FloridaTimeZone | (string & {});
  /** FL-D3; default false. */
  isPublicAgency?: boolean;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  /** true for synthetic data (fixtures and seeds). */
  isTestRecord?: boolean;
  sites: readonly ProvisionSiteInput[];
}

/**
 * Creates a tenant with its sites and audit genesis. Rejects anything outside Florida
 * with SQLSTATE 23514 (check_violation). The audit rows name the context's actor label
 * with actor type system. Returns the organization id.
 */
export async function provisionOrganization(
  tx: Tx,
  context: TransactionContext,
  input: ProvisionOrganizationInput,
): Promise<string> {
  const organization = {
    id: input.id,
    legal_name: input.legalName,
    award_type: input.awardType,
    sub_programs: input.subPrograms,
    grant_number: input.grantNumber,
    npi: input.npi,
    time_zone: input.timeZone,
    is_public_agency: input.isPublicAgency ?? false,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2,
    city: input.city,
    state: input.state,
    postal_code: input.postalCode,
    is_test_record: input.isTestRecord ?? false,
  };
  const sites = input.sites.map((s) => ({
    id: s.id,
    name: s.name,
    form_5b_site_id: s.form5bSiteId,
    site_type: s.siteType,
    address_line1: s.addressLine1,
    address_line2: s.addressLine2,
    city: s.city,
    state: s.state,
    postal_code: s.postalCode,
    time_zone: s.timeZone,
    valid_from: s.validFrom,
  }));
  const result = await tx.execute<{ id: string }>(sql`
    SELECT platform.provision_organization(${JSON.stringify(organization)}::jsonb,
                                           ${JSON.stringify(sites)}::jsonb,
                                           ${context.actor.label}::text)::text AS id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('platform.provision_organization returned no id');
  return id;
}

export interface TenantListEntry {
  organizationId: string;
  timeZone: FloridaTimeZone;
  status: 'active' | 'suspended' | 'offboarding';
}

/** The tenant list for scheduled fan-out (ids and time zones only, no names or PII). */
export async function listTenants(tx: Tx): Promise<TenantListEntry[]> {
  const result = await tx.execute<{
    organization_id: string;
    time_zone: FloridaTimeZone;
    status: TenantListEntry['status'];
  }>(
    sql`SELECT organization_id::text AS organization_id, time_zone, status FROM platform.list_tenants()`,
  );
  return result.rows.map((r) => ({
    organizationId: r.organization_id,
    timeZone: r.time_zone,
    status: r.status,
  }));
}

/** Creates audit partitions for the current UTC month and the next monthsAhead months. */
export async function ensureAuditPartitions(tx: Tx, monthsAhead = 3): Promise<number> {
  const result = await tx.execute<{ created: number }>(
    sql`SELECT audit.ensure_partitions(${monthsAhead}::int) AS created`,
  );
  return Number(result.rows[0]?.created ?? 0);
}
