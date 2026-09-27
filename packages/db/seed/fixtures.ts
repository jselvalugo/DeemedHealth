/**
 * Synthetic tenants for seeds and tests. SYNTHETIC ONLY: no real person, organization,
 * NPI, license, or address. Every record carries `test: true` and is stored with
 * is_test_record = true. NPIs come only from makeTestNpi() in @deemed/test-fixtures.
 * No SSN anywhere (decision D1).
 *
 * FX-ORG-XYZ (docs/qa/fixture-plan.md section 2): XYZ Community Health Center, a section 330
 * recipient with three Florida sites, two Eastern and one Central (western Panhandle).
 *
 * The requirementIds used below follow the catalog id format. Only CM-05-C&P-LIP-LICENSURE
 * appears in the framework today; the others are placeholders until hrsa-regulatory-analyst
 * publishes verified catalog entries.
 */
import { makeTestNpi } from '@deemed/test-fixtures/npi';
import type { ProvisionOrganizationInput } from '../src/platform.js';

/** Deterministic UUID for a fixture record: tenant prefix, record kind, sequence. */
export function fixtureId(tenantPrefix: string, kind: number, n: number): string {
  if (!/^[0-9a-f]{8}$/.test(tenantPrefix)) throw new Error('tenantPrefix must be 8 hex digits');
  return `${tenantPrefix}-${kind.toString(16).padStart(4, '0')}-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const KIND = {
  organization: 1,
  site: 2,
  person: 3,
  userAccount: 4,
  roleAssignment: 5,
  requirementInstance: 6,
  task: 7,
  approval: 8,
} as const;

export interface FixtureRoleGrant {
  roleKey: string;
  /** Site key from the fixture; omitted = all sites. */
  site?: string;
  /** Days until expiry, from seeding time. Required for the auditor role (max 30). */
  expiresInDays?: number;
}

export interface FixturePerson {
  key: string;
  givenName: string;
  familyName: string;
  preferredName?: string;
  workEmail: string;
  /** Seed for makeTestNpi (type 1); providers only. */
  npiSeed?: number;
  /** A sign-in account with these roles. */
  account?: { roles: readonly FixtureRoleGrant[] };
  test: true;
}

export interface FixtureRequirementInstance {
  key: string;
  requirementId: string;
  subject:
    { type: 'organization' } | { type: 'site'; site: string } | { type: 'person'; person: string };
  site?: string;
  owner?: string;
  status: 'met' | 'due_soon' | 'overdue' | 'missing' | 'not_applicable';
  notApplicableReason?: string;
  nextDueOn?: string;
  test: true;
}

export interface FixtureTask {
  key: string;
  title: string;
  requirementInstance?: string;
  site?: string;
  assignee?: string;
  dueOn?: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  test: true;
}

export interface FixtureApproval {
  key: string;
  task: string;
  /** Person key of the approver; must have an account. */
  approver: string;
  decision: 'approved' | 'rejected';
  comment?: string;
  requirementIds: readonly string[];
  test: true;
}

export interface TenantFixture {
  fixtureId: string;
  /** 8 hex digits used as the prefix of every record id. */
  idPrefix: string;
  organization: Omit<ProvisionOrganizationInput, 'sites' | 'id'> & { test: true };
  sites: ReadonlyArray<ProvisionOrganizationInput['sites'][number] & { key: string; test: true }>;
  people: readonly FixturePerson[];
  requirementInstances: readonly FixtureRequirementInstance[];
  tasks: readonly FixtureTask[];
  approvals: readonly FixtureApproval[];
  /** Identity provider issuer for the fixture's demo accounts. */
  idpIssuer: string;
  emailDomain: string;
}

export const XYZ_FIXTURE: TenantFixture = {
  fixtureId: 'FX-ORG-XYZ',
  idPrefix: 'd0000001',
  idpIssuer: 'https://idp.xyz-chc.example/',
  emailDomain: 'xyz-chc.example',
  organization: {
    legalName: 'XYZ Community Health Center',
    awardType: 'section330',
    subPrograms: ['CHC', 'HCH'],
    grantNumber: 'TEST-H80-000001',
    npi: makeTestNpi(1, 2).value,
    timeZone: 'America/New_York',
    isPublicAgency: false,
    addressLine1: '100 Example Health Way',
    city: 'Orlando',
    state: 'FL',
    postalCode: '32801',
    isTestRecord: true,
    test: true,
  },
  sites: [
    {
      key: 'S1',
      name: 'XYZ-S1 Main',
      form5bSiteId: 'TEST-5B-0001',
      addressLine1: '100 Example Health Way',
      city: 'Orlando',
      state: 'FL',
      postalCode: '32801',
      timeZone: 'America/New_York',
      validFrom: '2020-01-01',
      test: true,
    },
    {
      key: 'S2',
      name: 'XYZ-S2 East',
      form5bSiteId: 'TEST-5B-0002',
      addressLine1: '200 Sample Clinic Road',
      city: 'Jacksonville',
      state: 'FL',
      postalCode: '32202',
      timeZone: 'America/New_York',
      validFrom: '2021-07-01',
      test: true,
    },
    {
      key: 'S3',
      name: 'XYZ-S3 Panhandle',
      form5bSiteId: 'TEST-5B-0003',
      addressLine1: '300 Placeholder Avenue',
      city: 'Pensacola',
      state: 'FL',
      postalCode: '32501',
      timeZone: 'America/Chicago',
      validFrom: '2023-03-01',
      test: true,
    },
  ],
  people: [
    {
      key: 'admin',
      givenName: 'Angela',
      familyName: 'Morales',
      workEmail: 'angela.morales@xyz-chc.example',
      account: { roles: [{ roleKey: 'org_admin' }] },
      test: true,
    },
    {
      key: 'compliance',
      givenName: 'María',
      familyName: 'Delgado',
      preferredName: 'Mari',
      workEmail: 'maria.delgado@xyz-chc.example',
      account: { roles: [{ roleKey: 'compliance_officer' }] },
      test: true,
    },
    {
      key: 'ceo',
      givenName: 'James',
      familyName: 'Whitfield',
      workEmail: 'james.whitfield@xyz-chc.example',
      account: { roles: [{ roleKey: 'executive' }] },
      test: true,
    },
    {
      key: 'credentialing',
      givenName: 'Luis',
      familyName: 'Fernández-Ortiz',
      workEmail: 'luis.fernandez@xyz-chc.example',
      account: {
        roles: [
          { roleKey: 'credentialing_coordinator', site: 'S1' },
          { roleKey: 'credentialing_coordinator', site: 'S2' },
        ],
      },
      test: true,
    },
    {
      key: 'qi',
      givenName: 'Keisha',
      familyName: 'Brown',
      workEmail: 'keisha.brown@xyz-chc.example',
      account: { roles: [{ roleKey: 'qi_risk_manager', site: 'S3' }] },
      test: true,
    },
    {
      key: 'provider1',
      givenName: 'Priya',
      familyName: 'Raman',
      workEmail: 'priya.raman@xyz-chc.example',
      npiSeed: 101,
      account: {
        roles: [
          { roleKey: 'staff_provider', site: 'S1' },
          { roleKey: 'staff_provider', site: 'S2' },
        ],
      },
      test: true,
    },
    {
      key: 'provider2',
      givenName: 'Tomás',
      familyName: 'Rivera',
      workEmail: 'tomas.rivera@xyz-chc.example',
      npiSeed: 102,
      account: { roles: [{ roleKey: 'staff_provider', site: 'S3' }] },
      test: true,
    },
    {
      key: 'auditor',
      givenName: 'Ellen',
      familyName: 'Park',
      workEmail: 'ellen.park@auditor.example',
      account: { roles: [{ roleKey: 'auditor', expiresInDays: 14 }] },
      test: true,
    },
    {
      key: 'nurse',
      givenName: 'Grace',
      familyName: 'Okafor',
      workEmail: 'grace.okafor@xyz-chc.example',
      test: true,
    },
  ],
  requirementInstances: [
    {
      key: 'lic-raman',
      requirementId: 'CM-05-C&P-LIP-LICENSURE',
      subject: { type: 'person', person: 'provider1' },
      site: 'S1',
      owner: 'credentialing',
      status: 'met',
      nextDueOn: '2028-02-29',
      test: true,
    },
    {
      key: 'lic-rivera',
      requirementId: 'CM-05-C&P-LIP-LICENSURE',
      subject: { type: 'person', person: 'provider2' },
      site: 'S3',
      owner: 'credentialing',
      status: 'due_soon',
      nextDueOn: '2026-10-31',
      test: true,
    },
    {
      key: 'board',
      requirementId: 'CM-20-BOARD-COMPOSITION',
      subject: { type: 'organization' },
      owner: 'compliance',
      status: 'missing',
      test: true,
    },
    {
      key: 'sfds-s3',
      requirementId: 'CM-09-SLIDING-FEE-DISCOUNT',
      subject: { type: 'site', site: 'S3' },
      site: 'S3',
      owner: 'compliance',
      status: 'overdue',
      nextDueOn: '2026-09-01',
      test: true,
    },
  ],
  tasks: [
    {
      key: 'renew-rivera',
      title: 'Upload renewed Florida license',
      requirementInstance: 'lic-rivera',
      site: 'S3',
      assignee: 'credentialing',
      dueOn: '2026-10-15',
      status: 'open',
      test: true,
    },
    {
      key: 'board-roster',
      title: 'Confirm board roster and patient-member status',
      requirementInstance: 'board',
      assignee: 'compliance',
      dueOn: '2026-11-01',
      status: 'in_progress',
      test: true,
    },
    {
      key: 'sfds-review',
      title: 'Review sliding fee discount schedule for the Panhandle site',
      requirementInstance: 'sfds-s3',
      site: 'S3',
      assignee: 'qi',
      dueOn: '2026-09-01',
      status: 'done',
      test: true,
    },
  ],
  approvals: [
    {
      key: 'sfds-approve',
      task: 'sfds-review',
      approver: 'compliance',
      decision: 'approved',
      comment: 'Schedule reviewed against the current FPG table.',
      requirementIds: ['CM-09-SLIDING-FEE-DISCOUNT'],
      test: true,
    },
  ],
};

/**
 * A second, smaller synthetic tenant (a Look-Alike in the Central zone) so tenant
 * isolation can be tested with rows in every table for two tenants.
 */
export const GULF_FIXTURE: TenantFixture = {
  fixtureId: 'FX-ORG-GULF',
  idPrefix: 'd0000002',
  idpIssuer: 'https://idp.gulf-chc.example/',
  emailDomain: 'gulf-chc.example',
  organization: {
    legalName: 'Gulf Breeze Test Health Center',
    awardType: 'lookalike',
    subPrograms: ['CHC'],
    npi: makeTestNpi(2, 2).value,
    timeZone: 'America/Chicago',
    isPublicAgency: true,
    addressLine1: '10 Fixture Lane',
    city: 'Panama City',
    state: 'FL',
    postalCode: '32401',
    isTestRecord: true,
    test: true,
  },
  sites: [
    {
      key: 'G1',
      name: 'Gulf G1 Main',
      form5bSiteId: 'TEST-5B-1001',
      addressLine1: '10 Fixture Lane',
      city: 'Panama City',
      state: 'FL',
      postalCode: '32401',
      timeZone: 'America/Chicago',
      validFrom: '2022-01-01',
      test: true,
    },
  ],
  people: [
    {
      key: 'compliance',
      givenName: 'Daniel',
      familyName: 'Nguyen',
      workEmail: 'daniel.nguyen@gulf-chc.example',
      account: { roles: [{ roleKey: 'compliance_officer' }] },
      test: true,
    },
    {
      key: 'provider1',
      givenName: 'Rosa',
      familyName: 'Castillo',
      workEmail: 'rosa.castillo@gulf-chc.example',
      npiSeed: 201,
      account: { roles: [{ roleKey: 'staff_provider', site: 'G1' }] },
      test: true,
    },
  ],
  requirementInstances: [
    {
      key: 'lic-castillo',
      requirementId: 'CM-05-C&P-LIP-LICENSURE',
      subject: { type: 'person', person: 'provider1' },
      site: 'G1',
      owner: 'compliance',
      status: 'met',
      nextDueOn: '2027-01-31',
      test: true,
    },
  ],
  tasks: [
    {
      key: 'verify-castillo',
      title: 'Verify license with the state board',
      requirementInstance: 'lic-castillo',
      site: 'G1',
      assignee: 'compliance',
      dueOn: '2026-12-31',
      status: 'done',
      test: true,
    },
  ],
  approvals: [
    {
      key: 'verify-approve',
      task: 'verify-castillo',
      approver: 'compliance',
      decision: 'approved',
      requirementIds: ['CM-05-C&P-LIP-LICENSURE'],
      test: true,
    },
  ],
};
