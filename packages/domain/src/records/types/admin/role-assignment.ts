/**
 * `role_assignment`: a role granted to a user account, optionally limited to one site
 * and optionally expiring (ADR-0006 rule 7). Administration › Users & roles.
 *
 * A grant is never edited in place (a database guard refuses it): it is revoked and a
 * new one granted, so "who could do what on date X" stays answerable. Grant and revoke
 * stay the step-up Administration actions from S3 (`admin.roles.grant`,
 * `admin.roles.revoke`, audited as `permission` events); the generic API lists, reads,
 * exports, and shows the history of grants. The health center administrator (`org_admin`,
 * D15) holds `admin:read` and `admin:write`; `admin:export` needs the compliance officer.
 */
import { z } from 'zod';
import { ROLE_IDS } from '../../../permissions.js';
import { Uuid, UtcTimestamp } from '../../../primitives.js';
import { defineRecordType } from '../../define.js';

export const RoleAssignmentFields = z.object({
  userAccountId: Uuid,
  roleKey: z.enum(ROLE_IDS),
  siteId: Uuid.nullable(),
  validFrom: UtcTimestamp,
  expiresAt: UtcTimestamp.nullable(),
  grantReason: z.string().trim().min(1).max(500).nullable(),
  revokedAt: UtcTimestamp.nullable(),
  revokedBy: Uuid.nullable(),
  revokeReason: z.string().trim().min(1).max(500).nullable(),
  approvalArea: z.string().min(1).max(40).nullable(),
});

export const roleAssignmentRecord = defineRecordType({
  id: 'role_assignment',
  module: 'admin',
  table: 'public.role_assignment',
  // Shown inside Users & roles; the module map "Record types" section confirms the route.
  slug: 'role-assignments',
  noun: 'Role assignment',
  schema: RoleAssignmentFields,
  fields: {
    userAccountId: { column: 'user_account_id', kind: 'uuid', filterable: true },
    roleKey: { column: 'role_key', kind: 'enum', values: ROLE_IDS, filterable: true },
    siteId: { column: 'site_id', kind: 'uuid', nullable: true, filterable: true },
    validFrom: { column: 'valid_from', kind: 'timestamp', sortable: true },
    expiresAt: {
      column: 'expires_at',
      kind: 'timestamp',
      nullable: true,
      filterable: true,
      sortable: true,
    },
    grantReason: { column: 'grant_reason', kind: 'text', nullable: true },
    revokedAt: { column: 'revoked_at', kind: 'timestamp', nullable: true, filterable: true },
    revokedBy: { column: 'revoked_by', kind: 'uuid', nullable: true },
    revokeReason: { column: 'revoke_reason', kind: 'text', nullable: true },
    approvalArea: { column: 'approval_area', kind: 'text', nullable: true },
    createdAt: { column: 'created_at', kind: 'timestamp' },
  },
  list: {
    defaultColumns: ['userAccountId', 'roleKey', 'siteId', 'validFrom', 'expiresAt', 'revokedAt'],
    defaultSort: [{ field: 'validFrom', dir: 'desc' }],
  },
  detail: {
    sections: [
      { id: 'grant', fields: ['userAccountId', 'roleKey', 'siteId', 'approvalArea'] },
      { id: 'dates', fields: ['validFrom', 'expiresAt'] },
      { id: 'reasons', fields: ['grantReason', 'revokedAt', 'revokedBy', 'revokeReason'] },
    ],
    tabs: ['history'],
  },
  access: {
    read: 'admin:read',
    create: 'admin:write',
    update: 'admin:write',
    archive: 'admin:write',
    export: 'admin:export',
    recordRules: ['site_scope'],
  },
  actions: ['list', 'get', 'history', 'export', 'views'],
  managedBy:
    'Grant and revoke are the step-up Administration actions admin.roles.grant and admin.roles.revoke',
  siteScope: { column: 'site_id' },
  requirementIds: [],
  nonRegulatory: true,
  readinessFields: [],
  import: { enabled: false, naturalKey: [], headers: {} },
  archivable: false,
  versioned: true,
  fixture: 'role_assignment',
  supportReadable: false,
  publicRecord: 'to_verify',
  comments: false,
});
