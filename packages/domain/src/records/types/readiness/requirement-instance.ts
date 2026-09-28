/**
 * `requirement_instance`: a catalog requirement applied to the organization, a site, or
 * a person ("everything is a requirement instance"). HRSA Readiness › Requirements, the
 * module's primary record type (list at the module root `/readiness`).
 *
 * Status and next due date are derived: only the readiness engine sets them (from
 * evidence, dates, and catalog parameters), never a user or an import. Users set the
 * owner. "Not applicable" with a reason is its own audited action in S4 (readiness),
 * not a generic update. `org_admin` has no readiness permission (D15).
 */
import { z } from 'zod';
import { RequirementInstanceStatus } from '../../../entities/requirement.js';
import { IsoDate, RequirementId, Uuid, UtcTimestamp } from '../../../primitives.js';
import { defineRecordType } from '../../define.js';

export const REQUIREMENT_INSTANCE_STATUSES = RequirementInstanceStatus.options;
/** Subjects the table accepts today (contracts arrive with the Contracts module). */
export const REQUIREMENT_SUBJECT_TYPES = ['organization', 'site', 'person'] as const;

export const RequirementInstanceFields = z.object({
  requirementId: RequirementId,
  subjectType: z.enum(REQUIREMENT_SUBJECT_TYPES),
  subjectId: Uuid,
  siteId: Uuid.nullable(),
  ownerPersonId: Uuid.nullable(),
  status: RequirementInstanceStatus,
  notApplicableReason: z.string().trim().min(1).max(2000).nullable(),
  nextDueOn: IsoDate.nullable(),
  statusComputedAt: UtcTimestamp.nullable(),
});

export const requirementInstanceRecord = defineRecordType({
  id: 'requirement_instance',
  module: 'readiness',
  table: 'public.requirement_instance',
  slug: '',
  noun: 'Requirement instance',
  schema: RequirementInstanceFields,
  fields: {
    requirementId: {
      column: 'requirement_id',
      kind: 'text',
      searchable: 'exact',
      filterable: true,
      sortable: true,
      editable: 'create',
    },
    subjectType: {
      column: 'subject_type',
      kind: 'enum',
      values: REQUIREMENT_SUBJECT_TYPES,
      filterable: true,
      editable: 'create',
    },
    subjectId: { column: 'subject_id', kind: 'uuid', editable: 'create' },
    siteId: {
      column: 'site_id',
      kind: 'uuid',
      nullable: true,
      filterable: true,
      editable: 'create',
    },
    ownerPersonId: {
      column: 'owner_person_id',
      kind: 'uuid',
      nullable: true,
      filterable: true,
      editable: 'always',
      bulkEditable: true,
    },
    status: {
      column: 'status',
      kind: 'enum',
      values: REQUIREMENT_INSTANCE_STATUSES,
      filterable: true,
      sortable: true,
    },
    notApplicableReason: { column: 'not_applicable_reason', kind: 'text', nullable: true },
    nextDueOn: {
      column: 'next_due_on',
      kind: 'date',
      nullable: true,
      filterable: true,
      sortable: true,
    },
    statusComputedAt: { column: 'status_computed_at', kind: 'timestamp', nullable: true },
    createdAt: { column: 'created_at', kind: 'timestamp' },
  },
  rules: {
    required: ['requirementId', 'subjectType', 'subjectId'],
    refine: (r) => {
      // A site-level instance belongs to that site; an organization-level one to no site.
      if (r.subjectType === 'site' && r.siteId !== r.subjectId) return ['siteId'];
      if (r.subjectType === 'organization' && r.siteId !== null && r.siteId !== undefined) {
        return ['siteId'];
      }
      return [];
    },
  },
  lifecycle: {
    field: 'status',
    initial: 'missing',
    states: REQUIREMENT_INSTANCE_STATUSES,
    // "Mark not applicable" (reason required) arrives with the readiness module (S4).
    transitions: [],
    derived: ['met', 'due_soon', 'overdue', 'missing'],
  },
  owner: { field: 'ownerPersonId' },
  list: {
    defaultColumns: ['requirementId', 'subjectType', 'siteId', 'status', 'nextDueOn'],
    defaultSort: [{ field: 'nextDueOn', dir: 'asc' }],
  },
  detail: {
    sections: [
      { id: 'summary', fields: ['requirementId', 'subjectType', 'subjectId', 'siteId'] },
      {
        id: 'status',
        fields: ['status', 'nextDueOn', 'statusComputedAt', 'notApplicableReason'],
      },
      { id: 'owner', fields: ['ownerPersonId'] },
    ],
    tabs: ['evidence', 'tasks', 'comments', 'approvals', 'history'],
  },
  access: {
    read: 'readiness:read',
    create: 'readiness:write',
    update: 'readiness:write',
    archive: 'readiness:write',
    export: 'readiness:export',
    recordRules: ['site_scope', 'own', 'state_lock', 'auditor_scope'],
  },
  actions: [
    'list',
    'get',
    'create',
    'update',
    'archive',
    'restore',
    'bulk',
    'history',
    'export',
    'views',
  ],
  siteScope: { column: 'site_id' },
  // Each row is an instance of its own catalog requirement (rowRequirementIdField).
  requirementIds: [],
  catalogPending: 'Each row names its own requirementId; the catalog is not compiled yet',
  rowRequirementIdField: 'requirementId',
  readinessFields: ['ownerPersonId'],
  import: { enabled: false, naturalKey: [], headers: {} },
  archivable: true,
  versioned: true,
  fixture: 'requirement_instance',
  supportReadable: true,
  publicRecord: 'likely',
  comments: true,
});
