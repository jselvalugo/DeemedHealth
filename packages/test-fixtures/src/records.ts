/**
 * Fixture factories for record types (ADR-0014 section 2.9: "Each record type supplies a
 * fixture factory in packages/test-fixtures; a type without one fails CI").
 *
 * A factory returns the field values (keyed by the record type's field names) of one
 * synthetic record. SYNTHETIC ONLY: example.org addresses, Florida placeholder
 * addresses, NPIs from makeTestNpi, never a real person or organization, and no SSN
 * (decision D1). Every record written from these carries is_test_record where the table
 * has it (the API sets it outside production).
 *
 * The key is the record type's `fixture` declaration; `records.test.ts` fails when a
 * registered type has no factory or its factory's create payload does not parse.
 */
import { makeTestNpi } from './npi.js';

export interface RecordFixtureRefs {
  /** Sequence number; makes names, emails, NPIs, and Form 5B ids unique. */
  n: number;
  organizationId: string;
  /** Site the record belongs to (null: organization-wide). */
  siteId: string | null;
  /** A person in the same organization (owner, subject, account holder). */
  personId: string;
  /** A user account in the same organization (grantee). */
  userAccountId: string;
}

export type RecordFixture = (refs: RecordFixtureRefs) => Record<string, unknown>;

const pad = (n: number, width: number) => String(n % 10 ** width).padStart(width, '0');

export const RECORD_FIXTURES: Readonly<Record<string, RecordFixture>> = {
  site: ({ n }) => ({
    name: `Synthetic Site ${n}`,
    form5bSiteId: `TEST-5B-9${pad(n, 5)}`,
    siteType: 'service_delivery',
    addressLine1: `${n} Fixture Road`,
    addressLine2: null,
    city: 'Tampa',
    postalCode: '33602',
    timeZone: 'America/New_York',
    validFrom: '2026-01-01',
    validTo: null,
  }),
  person: ({ n }) => ({
    givenName: 'Fixture',
    familyName: `Person ${n}`,
    preferredName: null,
    workEmail: `fixture.person.${n}@example.org`,
    npi: makeTestNpi(50_000_000 + (n % 1_000_000), 1).value,
  }),
  user_account: ({ n, personId }) => ({
    personId,
    loginEmail: `fixture.user.${n}@example.org`,
    status: 'active',
    idpIssuer: 'local',
    idpSubject: `fixture-${n}`,
    mfaEnrolledAt: null,
    lastLoginAt: null,
    isTestRecord: true,
  }),
  role_assignment: ({ siteId, userAccountId }) => ({
    userAccountId,
    roleKey: 'staff_provider',
    siteId,
    validFrom: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    grantReason: 'Synthetic fixture grant',
  }),
  requirement_instance: ({ organizationId, siteId, personId }) => ({
    requirementId: 'CM-05-C&P-LIP-LICENSURE',
    subjectType: siteId ? 'site' : 'organization',
    subjectId: siteId ?? organizationId,
    siteId,
    ownerPersonId: personId,
  }),
};
