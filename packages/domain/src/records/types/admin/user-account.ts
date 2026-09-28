/**
 * `user_account`: a person's sign-in identity (ADR-0006). Administration › Users & roles.
 *
 * Read-only through the generic API in S4b. Invitations (enrollment token delivered out
 * of band), deactivation (sessions revoked), and email changes are account-lifecycle
 * actions with their own security rules; they are S7 custom actions, not generic
 * create/update/archive. The health center administrator (`org_admin`, D15) reads and
 * manages accounts; it holds no compliance module data.
 */
import { z } from 'zod';
import { Uuid, UtcTimestamp } from '../../../primitives.js';
import { defineRecordType } from '../../define.js';

export const USER_ACCOUNT_STATUSES = ['invited', 'active', 'suspended', 'deprovisioned'] as const;

export const UserAccountFields = z.object({
  personId: Uuid,
  idpIssuer: z.string().min(1).max(500),
  idpSubject: z.string().min(1).max(500),
  loginEmail: z.string().max(254).email(),
  status: z.enum(USER_ACCOUNT_STATUSES),
  mfaEnrolledAt: UtcTimestamp.nullable(),
  lastLoginAt: UtcTimestamp.nullable(),
  isTestRecord: z.boolean(),
});

export const userAccountRecord = defineRecordType({
  id: 'user_account',
  module: 'admin',
  table: 'public.user_account',
  // Module map: Administration › Users & roles `/admin/users`.
  slug: 'users',
  noun: 'User account',
  schema: UserAccountFields,
  fields: {
    personId: { column: 'person_id', kind: 'uuid', filterable: true },
    loginEmail: { column: 'login_email', kind: 'text', searchable: 'exact' },
    status: {
      column: 'status',
      kind: 'enum',
      values: USER_ACCOUNT_STATUSES,
      filterable: true,
      sortable: true,
    },
    idpIssuer: { column: 'idp_issuer', kind: 'text' },
    idpSubject: { column: 'idp_subject', kind: 'text' },
    mfaEnrolledAt: { column: 'mfa_enrolled_at', kind: 'timestamp', nullable: true },
    lastLoginAt: { column: 'last_login_at', kind: 'timestamp', nullable: true, sortable: true },
    isTestRecord: { column: 'is_test_record', kind: 'boolean' },
    createdAt: { column: 'created_at', kind: 'timestamp' },
  },
  lifecycle: {
    field: 'status',
    initial: 'invited',
    states: USER_ACCOUNT_STATUSES,
    // Invite, activate, suspend, and deprovision arrive with S7 (sessions revoked, audited).
    transitions: [],
    derived: [],
  },
  list: {
    defaultColumns: ['loginEmail', 'status', 'lastLoginAt'],
    defaultSort: [{ field: 'status', dir: 'asc' }],
  },
  detail: {
    sections: [
      { id: 'summary', fields: ['loginEmail', 'status', 'personId'] },
      { id: 'sign_in', fields: ['idpIssuer', 'idpSubject', 'mfaEnrolledAt', 'lastLoginAt'] },
    ],
    tabs: ['history'],
  },
  history: { categories: ['mutation', 'permission'] },
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
    'Invitation, deactivation, and email change are S7 account actions (enrollment token, session revocation)',
  // Sites of the account's active role grants; none means organization-wide.
  siteScope: { via: 'user_account_sites' },
  requirementIds: [],
  nonRegulatory: true,
  readinessFields: [],
  import: { enabled: false, naturalKey: [], headers: {} },
  archivable: true,
  versioned: true,
  fixture: 'user_account',
  supportReadable: false,
  publicRecord: 'to_verify',
  comments: false,
});
