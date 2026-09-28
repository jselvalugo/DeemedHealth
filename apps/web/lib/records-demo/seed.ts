/**
 * Synthetic records for the non-production demo (ADR-0009, decision D9): the XYZ
 * Community Health Center fixture (FX-ORG-XYZ in packages/db/seed/fixtures.ts), with the
 * same id scheme, plus one mobile site with no dependents so archive can be tried.
 * SYNTHETIC ONLY: no real person, organization, NPI, or address; NPIs come from
 * makeTestNpi(); reserved `.example` domains; no SSN anywhere (D1).
 */

/** `d0000001-<kind>-4000-8000-<n>`, as fixtureId() in packages/db/seed/fixtures.ts. */
export function demoId(kind: number, n: number): string {
  return `d0000001-${kind.toString(16).padStart(4, '0')}-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const DEMO_ORG_ID = demoId(1, 1);

export type SeedRow = {
  id: string;
  values: Record<string, unknown>;
  /** Clear values of masked fields (returned only by the audited reveal). */
  secrets?: Record<string, string | null>;
  archivedAt?: string | null;
};

const CREATED = '2026-01-05T14:00:00.000Z';

const SITES = [
  ['XYZ-S1 Main', 'TEST-5B-0001', 'service_delivery', '100 Example Health Way', 'Orlando', '32801', 'America/New_York', '2020-01-01'],
  ['XYZ-S2 East', 'TEST-5B-0002', 'service_delivery', '200 Sample Clinic Road', 'Jacksonville', '32202', 'America/New_York', '2021-07-01'],
  ['XYZ-S3 Panhandle', 'TEST-5B-0003', 'service_delivery', '300 Placeholder Avenue', 'Pensacola', '32501', 'America/Chicago', '2023-03-01'],
  ['XYZ-S4 Mobile Unit', 'TEST-5B-0004', 'mobile', '100 Example Health Way', 'Orlando', '32801', 'America/New_York', '2025-06-01'],
] as const;

export const SITE_IDS = SITES.map((_, i) => demoId(2, i + 1));

type Person = {
  key: string;
  given: string;
  family: string;
  preferred?: string;
  npi?: string;
  roles?: readonly (readonly [role: string, site?: number])[];
  status?: 'active' | 'invited';
  dob?: string;
  home?: string;
};

// Synthetic NPIs: makeTestNpi(101) and makeTestNpi(102) from @deemed/test-fixtures.
const PEOPLE: readonly Person[] = [
  { key: 'angela.morales', given: 'Angela', family: 'Morales', roles: [['org_admin']] },
  { key: 'maria.delgado', given: 'María', family: 'Delgado', preferred: 'Mari', roles: [['compliance_officer']] },
  { key: 'james.whitfield', given: 'James', family: 'Whitfield', roles: [['executive']] },
  {
    key: 'luis.fernandez',
    given: 'Luis',
    family: 'Fernández-Ortiz',
    roles: [
      ['credentialing_coordinator', 0],
      ['credentialing_coordinator', 1],
    ],
  },
  { key: 'keisha.brown', given: 'Keisha', family: 'Brown', roles: [['qi_risk_manager', 2]] },
  {
    key: 'priya.raman',
    given: 'Priya',
    family: 'Raman',
    npi: '1000001010',
    roles: [
      ['staff_provider', 0],
      ['staff_provider', 1],
    ],
    dob: '1985-03-14',
    home: '12 Sample Street, Orlando, FL 32801',
  },
  {
    key: 'tomas.rivera',
    given: 'Tomás',
    family: 'Rivera',
    npi: '1000001028',
    roles: [['staff_provider', 2]],
    status: 'invited',
    dob: '1979-11-02',
  },
  { key: 'ellen.park', given: 'Ellen', family: 'Park', roles: [['auditor']] },
  { key: 'grace.okafor', given: 'Grace', family: 'Okafor' },
];

export const PERSON_IDS = Object.fromEntries(PEOPLE.map((p, i) => [p.key, demoId(3, i + 1)]));

export type DemoSeed = Record<string, SeedRow[]>;

export function demoSeed(): DemoSeed {
  const site: SeedRow[] = SITES.map(([name, form5b, type, line1, city, zip, tz, from], i) => ({
    id: SITE_IDS[i] as string,
    values: {
      name,
      form5bSiteId: form5b,
      siteType: type,
      addressLine1: line1,
      addressLine2: null,
      city,
      state: 'FL',
      postalCode: zip,
      timeZone: tz,
      validFrom: from,
      validTo: null,
      isTestRecord: true,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
  }));

  const person: SeedRow[] = [];
  const userAccount: SeedRow[] = [];
  const roleAssignment: SeedRow[] = [];
  PEOPLE.forEach((p, i) => {
    const id = demoId(3, i + 1);
    const email = p.key.endsWith('park')
      ? `${p.key}@auditor.example`
      : `${p.key}@xyz-chc.example`;
    person.push({
      id,
      values: {
        givenName: p.given,
        familyName: p.family,
        preferredName: p.preferred ?? null,
        workEmail: email,
        npi: p.npi ?? null,
        isTestRecord: true,
        createdAt: CREATED,
        updatedAt: CREATED,
      },
      secrets: { dob: p.dob ?? null, homeAddress: p.home ?? null },
    });
    if (!p.roles) return;
    const accountId = demoId(4, userAccount.length + 1);
    const active = p.status !== 'invited';
    userAccount.push({
      id: accountId,
      values: {
        personId: id,
        loginEmail: email,
        status: p.status ?? 'active',
        idpIssuer: 'https://idp.xyz-chc.example/',
        idpSubject: `xyz-${p.key}`,
        mfaEnrolledAt: active ? '2026-01-06T15:10:00.000Z' : null,
        lastLoginAt: active ? '2026-09-25T13:42:00.000Z' : null,
        isTestRecord: true,
        createdAt: CREATED,
      },
    });
    for (const [role, siteIndex] of p.roles) {
      roleAssignment.push({
        id: demoId(5, roleAssignment.length + 1),
        values: {
          userAccountId: accountId,
          roleKey: role,
          siteId: siteIndex === undefined ? null : SITE_IDS[siteIndex],
          validFrom: CREATED,
          // The auditor role always ends (at most 30 days, ADR-0006 rule 7).
          expiresAt: role === 'auditor' ? '2026-10-12T04:00:00.000Z' : null,
          grantReason: role === 'auditor' ? 'Annual financial audit engagement' : 'Initial setup',
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
          approvalArea: null,
          createdAt: CREATED,
        },
      });
    }
  });

  const pid = (key: string) => PERSON_IDS[key] as string;
  const requirementInstance: SeedRow[] = [
    ['CM-05-C&P-LIP-LICENSURE', 'person', pid('priya.raman'), SITE_IDS[0], pid('luis.fernandez'), 'met', '2028-02-29'],
    ['CM-05-C&P-LIP-LICENSURE', 'person', pid('tomas.rivera'), SITE_IDS[2], pid('luis.fernandez'), 'due_soon', '2026-10-31'],
    ['CM-20-BOARD-COMPOSITION', 'organization', DEMO_ORG_ID, null, pid('maria.delgado'), 'missing', null],
    ['CM-09-SLIDING-FEE-DISCOUNT', 'site', SITE_IDS[2], SITE_IDS[2], pid('maria.delgado'), 'overdue', '2026-09-01'],
  ].map(([requirementId, subjectType, subjectId, siteId, owner, status, due], i) => ({
    id: demoId(6, i + 1),
    values: {
      requirementId,
      subjectType,
      subjectId,
      siteId,
      ownerPersonId: owner,
      status,
      notApplicableReason: null,
      nextDueOn: due,
      statusComputedAt: '2026-09-28T09:00:00.000Z',
      createdAt: CREATED,
    },
  }));

  return {
    site,
    person,
    user_account: userAccount,
    role_assignment: roleAssignment,
    requirement_instance: requirementInstance,
  };
}

/** A saved view shared with compliance officers (FX-ORG-XYZ "Central time zone sites"). */
export const SEED_VIEWS = [
  {
    id: demoId(9, 1),
    recordType: 'site',
    owner: 'seed-maria.delgado',
    name: 'Central time zone sites',
    visibility: 'roles' as const,
    sharedRoles: ['compliance_officer', 'org_admin'],
    query: {
      filters: [{ field: 'timeZone', op: 'eq' as const, value: 'America/Chicago' }],
      sort: [{ field: 'name', dir: 'asc' as const }],
      q: null,
    },
    columns: ['name', 'siteType', 'city', 'timeZone'],
  },
];
