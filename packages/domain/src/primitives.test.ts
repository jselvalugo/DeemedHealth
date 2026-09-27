import { describe, expect, it } from 'vitest';
import { IsoDate, isValidNpi, RequirementId, UtcTimestamp, Uuid } from './primitives.js';
import { DB_ROLES, organizationObjectPrefix, TENANT_COLUMN, TENANT_SETTINGS } from './tenancy.js';

describe('primitives', () => {
  it('accepts lowercase UUIDs only', () => {
    expect(Uuid.safeParse('01920000-0000-7000-8000-000000000001').success).toBe(true);
    expect(Uuid.safeParse('01920000-0000-7000-8000-00000000000A').success).toBe(false);
    expect(Uuid.safeParse('not-a-uuid').success).toBe(false);
  });

  it('accepts real calendar dates, including leap days', () => {
    expect(IsoDate.safeParse('2028-02-29').success).toBe(true);
    expect(IsoDate.safeParse('2026-02-29').success).toBe(false);
    expect(IsoDate.safeParse('2026-04-31').success).toBe(false);
    expect(IsoDate.safeParse('2026-12-31').success).toBe(true);
    expect(IsoDate.safeParse('2026-9-1').success).toBe(false);
  });

  it('requires UTC timestamps with Z and no offset', () => {
    expect(UtcTimestamp.safeParse('2026-09-27T14:03:11.123456Z').success).toBe(true);
    expect(UtcTimestamp.safeParse('2026-09-27T10:03:11-04:00').success).toBe(false);
    expect(UtcTimestamp.safeParse('2026-09-27').success).toBe(false);
  });

  it('validates NPI check digits', () => {
    expect(isValidNpi('1234567893')).toBe(true);
    expect(isValidNpi('1234567890')).toBe(false);
    expect(isValidNpi('123456789')).toBe(false);
  });

  it('matches the catalog requirementId pattern', () => {
    expect(RequirementId.safeParse('HRSA-CM05-CRED').success).toBe(true);
    expect(RequirementId.safeParse('hrsa-cm05').success).toBe(false);
    expect(RequirementId.safeParse('HRSA').success).toBe(false);
  });
});

describe('tenancy names (ADR-0011)', () => {
  it('uses organization_id and app.organization_id', () => {
    expect(TENANT_COLUMN).toBe('organization_id');
    expect(TENANT_SETTINGS.organizationId).toBe('app.organization_id');
  });

  it('lists exactly the five database roles', () => {
    expect(Object.values(DB_ROLES).sort()).toEqual(
      ['app_owner', 'app_platform', 'app_user', 'audit_retention', 'audit_writer'].sort(),
    );
  });

  it('builds the organization object prefix', () => {
    expect(organizationObjectPrefix('abc')).toBe('organizations/abc/');
  });
});
