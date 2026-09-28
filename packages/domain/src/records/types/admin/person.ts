/**
 * `person`: one row per human (staff, provider, board member, contractor contact).
 * Administration (the people behind user accounts). NO SSN field, now or later (D1):
 * people are matched on name, DOB, NPI, and license number, and the registry test
 * rejects any SSN-like field name or import header.
 *
 * Date of birth and home address are field-encrypted (ADR-0007) and masked: they are
 * never listed, filtered, sorted, exported, or imported, and are shown only through an
 * audited reveal with step-up and a reason. Writing them arrives with S6 (encryption).
 */
import { PersonFields } from '../../../entities/person.js';
import { defineRecordType } from '../../define.js';

export const personRecord = defineRecordType({
  id: 'person',
  module: 'admin',
  table: 'public.person',
  // Proposed list route `/admin/people`; the module map "Record types" section confirms it.
  slug: 'people',
  noun: 'Person',
  schema: PersonFields,
  fields: {
    givenName: {
      column: 'given_name',
      kind: 'text',
      searchable: 'text',
      editable: 'always',
      importable: true,
    },
    familyName: {
      column: 'family_name',
      kind: 'text',
      searchable: 'text',
      sortable: true,
      editable: 'always',
      importable: true,
    },
    preferredName: {
      column: 'preferred_name',
      kind: 'text',
      nullable: true,
      editable: 'always',
      importable: true,
    },
    workEmail: {
      column: 'work_email',
      kind: 'text',
      nullable: true,
      searchable: 'exact',
      editable: 'always',
      importable: true,
    },
    npi: {
      column: 'npi',
      kind: 'text',
      nullable: true,
      searchable: 'exact',
      filterable: true,
      editable: 'always',
      importable: true,
    },
    dob: {
      column: 'dob_enc',
      kind: 'date',
      nullable: true,
      reveal: { roles: ['compliance_officer'], stepUp: true },
    },
    homeAddress: {
      column: 'home_address_enc',
      kind: 'text',
      nullable: true,
      reveal: { roles: ['compliance_officer'], stepUp: true },
    },
    isTestRecord: { column: 'is_test_record', kind: 'boolean' },
    createdAt: { column: 'created_at', kind: 'timestamp' },
    updatedAt: { column: 'updated_at', kind: 'timestamp' },
  },
  rules: { required: ['givenName', 'familyName'] },
  list: {
    defaultColumns: ['familyName', 'givenName', 'workEmail', 'npi'],
    defaultSort: [{ field: 'familyName', dir: 'asc' }],
  },
  detail: {
    sections: [
      { id: 'summary', fields: ['givenName', 'familyName', 'preferredName', 'workEmail', 'npi'] },
      { id: 'sensitive', fields: ['dob', 'homeAddress'] },
    ],
    tabs: ['evidence', 'tasks', 'comments', 'history'],
  },
  access: {
    read: 'admin:read',
    create: 'admin:write',
    update: 'admin:write',
    archive: 'admin:write',
    export: 'admin:export',
    recordRules: ['site_scope', 'state_lock'],
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
    'import',
    'reveal',
    'views',
  ],
  // Sites where the person holds an active role grant; none means organization-wide.
  siteScope: { via: 'person_sites' },
  requirementIds: [],
  catalogPending:
    'Personnel requirements (credentialing ch. 5, screening, board ch. 19-20) attach to provider, board, and screening record types; ids are not compiled yet',
  readinessFields: [],
  import: {
    enabled: true,
    naturalKey: ['npi'],
    headers: {
      givenName: ['First name', 'Given name', 'Nombre'],
      familyName: ['Last name', 'Family name', 'Apellido'],
      preferredName: ['Preferred name', 'Nombre preferido'],
      workEmail: ['Work email', 'Correo electrónico del trabajo'],
      npi: ['NPI', 'Número NPI'],
    },
  },
  archiveBlockedBy: ['active_user_account'],
  archivable: true,
  versioned: true,
  fixture: 'person',
  supportReadable: true,
  publicRecord: 'to_verify',
  comments: true,
});
