import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as domain from './index.js';
import {
  Approval,
  Evidence,
  EvidenceVersion,
  Notification,
  Organization,
  Person,
  RequirementInstance,
  RoleAssignment,
  Site,
  Task,
} from './index.js';
import { HASH, ID, META, ORG, OTHER_ORG, PERSON, SITE, TS, USER } from './fixtures.test-utils.js';

const organization = {
  id: ORG,
  legalName: 'Synthetic Health Center, Inc.',
  awardType: 'section330',
  subPrograms: ['CHC'],
  grantNumber: 'H80CS00000',
  timeZone: 'America/New_York',
  isPublicAgency: false,
  state: 'FL',
  ...META,
};

const site = {
  id: SITE,
  organizationId: ORG,
  name: 'Main Street Clinic',
  form5bSiteId: null,
  siteType: 'service_delivery',
  addressLine1: '100 Synthetic Way',
  addressLine2: null,
  city: 'Pensacola',
  state: 'FL',
  postalCode: '32501',
  timeZone: 'America/Chicago',
  validFrom: '2026-01-01',
  validTo: null,
  ...META,
};

const person = {
  id: PERSON,
  organizationId: ORG,
  givenName: 'Ana',
  familyName: 'Synthetic',
  preferredName: null,
  workEmail: 'ana@example.org',
  npi: '1234567893',
  kinds: ['provider', 'staff'],
  hasDob: true,
  hasHomeAddress: false,
  identityUserId: USER,
  isTestRecord: true,
  ...META,
};

const instance = {
  id: ID(50),
  organizationId: ORG,
  requirement: {
    requirementId: 'HRSA-CM05-CRED',
    requirementVersionId: ID(51),
    catalogVersion: '0.1.0',
  },
  subjectType: 'person',
  subjectId: PERSON,
  siteId: SITE,
  ownerPersonId: PERSON,
  status: 'due_soon',
  notApplicableReason: null,
  nextDueOn: '2027-02-28',
  lastEvaluatedAt: TS,
  ...META,
};

const version = {
  id: ID(60),
  organizationId: ORG,
  evidenceId: ID(61),
  versionNo: 1,
  objectKey: `organizations/${ORG}/evidence/${ID(61)}/v1.pdf`,
  sha256: HASH,
  sizeBytes: 1024,
  mimeType: 'application/pdf',
  structuredFields: { licenseNumber: 'ME00000' },
  source: 'upload',
  sourceRef: null,
  validFrom: '2026-01-01',
  validTo: '2028-01-31',
  submittedBy: PERSON,
  createdAt: TS,
};

const task = {
  id: ID(70),
  organizationId: ORG,
  title: 'Upload renewed license',
  status: 'open',
  dueOn: '2027-01-31',
  sourceModule: 'providers',
  siteId: SITE,
  assigneePersonId: PERSON,
  assigneeRole: null,
  requirementInstanceId: ID(50),
  workflowRunId: null,
  requirementIds: ['HRSA-CM05-CRED'],
  ...META,
};

const approval = {
  id: ID(80),
  organizationId: ORG,
  workflowRunId: ID(81),
  subjectTable: 'privilege_set',
  subjectId: ID(82),
  subjectVersion: 3,
  approverType: 'user',
  approverPersonId: PERSON,
  approverRole: 'executive',
  decision: 'approved',
  reason: 'Committee recommendation reviewed',
  decidedAt: TS,
};

describe('Organization and Site', () => {
  it('parse valid Florida records', () => {
    expect(Organization.safeParse(organization).success).toBe(true);
    expect(Site.safeParse(site).success).toBe(true);
  });
  it('reject non-Florida state and time zone', () => {
    expect(Organization.safeParse({ ...organization, state: 'GA' }).success).toBe(false);
    expect(Site.safeParse({ ...site, timeZone: 'America/Denver' }).success).toBe(false);
  });
  it('reject an inverted validity range', () => {
    expect(Site.safeParse({ ...site, validTo: '2025-12-31' }).success).toBe(false);
  });
});

describe('Person', () => {
  it('parses a valid person', () => {
    expect(Person.safeParse(person).success).toBe(true);
  });
  it('rejects an SSN field and any other unknown key (decision D1)', () => {
    expect(Person.safeParse({ ...person, ssn: '000000000' }).success).toBe(false);
    expect(Person.safeParse({ ...person, dob: '1980-01-01' }).success).toBe(false);
  });
  it('rejects an invalid NPI', () => {
    expect(Person.safeParse({ ...person, npi: '1234567890' }).success).toBe(false);
  });
});

describe('RoleAssignment', () => {
  const base = {
    id: ID(90),
    organizationId: ORG,
    userAccountId: USER,
    personId: PERSON,
    role: 'credentialing_coordinator',
    siteScope: { kind: 'sites', siteIds: [SITE] },
    validFrom: '2026-10-01T00:00:00Z',
    validTo: null,
    grantedBy: USER,
    grantedAt: TS,
  };
  it('parses a site-scoped role', () => {
    expect(RoleAssignment.safeParse(base).success).toBe(true);
    expect(
      RoleAssignment.safeParse({ ...base, siteScope: { kind: 'sites', siteIds: [] } }).success,
    ).toBe(false);
  });
  it('requires an auditor end date of at most 30 days', () => {
    const auditor = { ...base, role: 'auditor', siteScope: { kind: 'all' } };
    expect(RoleAssignment.safeParse(auditor).success).toBe(false);
    expect(RoleAssignment.safeParse({ ...auditor, validTo: '2026-10-31T00:00:00Z' }).success).toBe(
      true,
    );
    expect(RoleAssignment.safeParse({ ...auditor, validTo: '2026-11-01T00:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('RequirementInstance', () => {
  it('parses a valid instance', () => {
    expect(RequirementInstance.safeParse(instance).success).toBe(true);
  });
  it('requires a reason exactly when not applicable', () => {
    expect(RequirementInstance.safeParse({ ...instance, status: 'not_applicable' }).success).toBe(
      false,
    );
    expect(
      RequirementInstance.safeParse({
        ...instance,
        status: 'not_applicable',
        notApplicableReason: 'No pharmacy at this site',
      }).success,
    ).toBe(true);
    // A kept mark under another status is valid: only a person clears a mark.
    expect(
      RequirementInstance.safeParse({ ...instance, notApplicableReason: 'kept mark' }).success,
    ).toBe(true);
    expect(RequirementInstance.safeParse({ ...instance, notApplicableReason: '   ' }).success).toBe(
      false,
    );
  });
});

describe('Evidence', () => {
  it('parses evidence and a version under the organization prefix', () => {
    expect(
      Evidence.safeParse({
        id: ID(61),
        organizationId: ORG,
        title: 'Florida medical license',
        evidenceType: 'state_license',
        currentVersionId: ID(60),
        legalHold: false,
        ...META,
      }).success,
    ).toBe(true);
    expect(EvidenceVersion.safeParse(version).success).toBe(true);
  });
  it("rejects an object key under another organization's prefix", () => {
    expect(
      EvidenceVersion.safeParse({
        ...version,
        objectKey: `organizations/${OTHER_ORG}/evidence/x.pdf`,
      }).success,
    ).toBe(false);
  });
  it('requires file metadata with an object key', () => {
    expect(EvidenceVersion.safeParse({ ...version, sha256: null }).success).toBe(false);
  });
});

describe('Task', () => {
  it('parses a valid task', () => {
    expect(Task.safeParse(task).success).toBe(true);
  });
  it('needs an assignee person or role queue', () => {
    expect(Task.safeParse({ ...task, assigneePersonId: null }).success).toBe(false);
    expect(
      Task.safeParse({ ...task, assigneePersonId: null, assigneeRole: 'credentialing_coordinator' })
        .success,
    ).toBe(true);
  });
  it('rejects an unknown source module', () => {
    expect(Task.safeParse({ ...task, sourceModule: 'todo' }).success).toBe(false);
  });
});

describe('Approval', () => {
  it('parses a human approval with version and reason', () => {
    expect(Approval.safeParse(approval).success).toBe(true);
  });
  it('rejects a non-human approver, a missing reason, or a missing version', () => {
    expect(Approval.safeParse({ ...approval, approverType: 'service' }).success).toBe(false);
    expect(Approval.safeParse({ ...approval, reason: '  ' }).success).toBe(false);
    const noVersion: Partial<typeof approval> = { ...approval };
    delete noVersion.subjectVersion;
    expect(Approval.safeParse(noVersion).success).toBe(false);
  });
});

describe('Notification', () => {
  it('parses an in-app notification', () => {
    expect(
      Notification.safeParse({
        id: ID(95),
        organizationId: ORG,
        recipientPersonId: PERSON,
        channel: 'in_app',
        templateKey: 'task.assigned',
        params: { taskTitle: 'Upload renewed license' },
        taskId: ID(70),
        requirementInstanceId: null,
        createdAt: TS,
        sentAt: null,
        readAt: null,
      }).success,
    ).toBe(true);
  });
});

/** Every object key reachable from a schema. */
function keysOf(schema: z.ZodTypeAny, seen = new Set<z.ZodTypeAny>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = schema._def as Record<string, unknown>;
  const out: string[] = [];
  if (schema instanceof z.ZodObject) {
    for (const [k, v] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      out.push(k, ...keysOf(v, seen));
    }
  }
  for (const key of ['schema', 'innerType', 'type', 'valueType', 'left', 'right']) {
    const child = def[key];
    if (child instanceof z.ZodType) out.push(...keysOf(child, seen));
  }
  const options = def['options'];
  if (Array.isArray(options)) for (const o of options) out.push(...keysOf(o, seen));
  return out;
}

describe('no SSN anywhere in the contracts (decision D1, G1-7)', () => {
  it('no exported schema has an SSN-like key', () => {
    const schemas = Object.values(domain).filter((v): v is z.ZodTypeAny => v instanceof z.ZodType);
    expect(schemas.length).toBeGreaterThan(20);
    const keys = schemas.flatMap((s) => keysOf(s));
    expect(keys).toContain('givenName');
    const bad = keys.filter((k) => /ssn|social_?security|tax_?payer/i.test(k));
    expect(bad).toEqual([]);
  });
});
