import { z } from 'zod';

/**
 * Shared primitives for the cross-module contracts. Canonical forms follow
 * ADR-0008 §2 (lowercase UUIDs, RFC 3339 UTC timestamps) so the same values can
 * be hashed into the audit chain without re-formatting.
 */

/** Lowercase, hyphenated UUID (v1-v8; ids are generated as UUIDv7). */
export const Uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'Expected a lowercase UUID',
  );
export type Uuid = z.infer<typeof Uuid>;

/** Calendar date without time (`date` column), YYYY-MM-DD, and a real date. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Not a real calendar date');
export type IsoDate = z.infer<typeof IsoDate>;

/** UTC instant (`timestamptz`), RFC 3339 with a `Z` suffix and no offset. */
export const UtcTimestamp = z.string().datetime({ offset: false });
export type UtcTimestamp = z.infer<typeof UtcTimestamp>;

/**
 * Florida has two time zones (docs/compliance/florida.md). Every organization and
 * site stores one of these (ADR-0002 §9).
 */
export const FloridaTimeZone = z.enum(['America/New_York', 'America/Chicago']);
export type FloridaTimeZone = z.infer<typeof FloridaTimeZone>;

/** Florida only (decision D4). */
export const FloridaState = z.literal('FL');

/**
 * Stable catalog requirementId. Same pattern as
 * `packages/requirements-catalog` (`RequirementId`), e.g. `HRSA-CM05-CRED-LIP`.
 */
export const RequirementId = z
  .string()
  .regex(/^[A-Z0-9]+(-[A-Za-z0-9&]+)+$/, 'Invalid requirementId');
export type RequirementId = z.infer<typeof RequirementId>;

/** Catalog release version (semver). */
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected semver');

/** Lowercase hex SHA-256 digest (64 characters). */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'Expected lowercase hex SHA-256');

/**
 * NPI check digit: Luhn over the constant prefix `80840` plus the first nine
 * digits (CMS NPI standard). Synthetic seed NPIs must pass this too.
 */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi}`.split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    let d = digits[i] as number;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
export const Npi = z.string().refine(isValidNpi, 'Invalid NPI');

/** Every tenant-owned record (ADR-0002, names per ADR-0011). */
export const TenantScoped = z.object({ organizationId: Uuid });

/** Bookkeeping columns on business records (docs/data/erd.md conventions). */
export const RecordMeta = z.object({
  createdAt: UtcTimestamp,
  createdBy: Uuid.nullable(),
  updatedAt: UtcTimestamp,
  updatedBy: Uuid.nullable(),
  archivedAt: UtcTimestamp.nullable(),
});

/** Refinement helper: `validTo` is open (null) or on or after `validFrom`. */
export function validRange(r: { validFrom: string; validTo: string | null }): boolean {
  return r.validTo === null || r.validTo >= r.validFrom;
}
