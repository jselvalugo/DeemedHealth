/**
 * `site`: a health center site (Form 5B). Administration › Organization & sites.
 * Florida only (D4): the state is fixed and the ZIP must be a Florida ZIP.
 */
import { SiteFields, SiteType } from '../../../entities/organization.js';
import { defineRecordType } from '../../define.js';

const FLORIDA_TIME_ZONES = ['America/New_York', 'America/Chicago'] as const;

/** Florida ZIP codes start with 32, 33, or 34 (checked with a loop, not a regex). */
export function isFloridaZip(value: unknown): boolean {
  if (typeof value !== 'string' || value.length < 5) return false;
  return value[0] === '3' && (value[1] === '2' || value[1] === '3' || value[1] === '4');
}

export const siteRecord = defineRecordType({
  id: 'site',
  module: 'admin',
  table: 'public.site',
  // Module map: Administration › Organization & sites `/admin/org`.
  slug: 'org',
  noun: 'Site',
  schema: SiteFields,
  fields: {
    name: {
      column: 'name',
      kind: 'text',
      searchable: 'text',
      sortable: true,
      editable: 'always',
      importable: true,
    },
    form5bSiteId: {
      column: 'form_5b_site_id',
      kind: 'text',
      nullable: true,
      searchable: 'exact',
      filterable: true,
      editable: 'always',
      importable: true,
    },
    siteType: {
      column: 'site_type',
      kind: 'enum',
      values: SiteType.options,
      filterable: true,
      sortable: true,
      editable: 'always',
      bulkEditable: true,
      importable: true,
    },
    addressLine1: { column: 'address_line1', kind: 'text', editable: 'always', importable: true },
    addressLine2: {
      column: 'address_line2',
      kind: 'text',
      nullable: true,
      editable: 'always',
      importable: true,
    },
    city: { column: 'city', kind: 'text', editable: 'always', importable: true },
    state: { column: 'state', kind: 'enum', values: ['FL'] },
    postalCode: { column: 'postal_code', kind: 'text', editable: 'always', importable: true },
    timeZone: {
      column: 'time_zone',
      kind: 'enum',
      values: FLORIDA_TIME_ZONES,
      filterable: true,
      editable: 'always',
      importable: true,
    },
    validFrom: {
      column: 'valid_from',
      kind: 'date',
      filterable: true,
      sortable: true,
      editable: 'always',
      importable: true,
    },
    validTo: {
      column: 'valid_to',
      kind: 'date',
      nullable: true,
      filterable: true,
      sortable: true,
      editable: 'always',
      importable: true,
    },
    isTestRecord: { column: 'is_test_record', kind: 'boolean' },
    createdAt: { column: 'created_at', kind: 'timestamp' },
    updatedAt: { column: 'updated_at', kind: 'timestamp' },
  },
  rules: {
    required: ['name', 'siteType', 'addressLine1', 'city', 'postalCode', 'timeZone', 'validFrom'],
    refine: (r) => {
      const bad: string[] = [];
      if (r.postalCode !== undefined && !isFloridaZip(r.postalCode)) bad.push('postalCode');
      if (
        typeof r.validFrom === 'string' &&
        typeof r.validTo === 'string' &&
        r.validTo < r.validFrom
      ) {
        bad.push('validTo');
      }
      return bad;
    },
  },
  list: {
    defaultColumns: ['name', 'siteType', 'city', 'timeZone', 'validFrom', 'validTo'],
    defaultSort: [{ field: 'name', dir: 'asc' }],
  },
  detail: {
    sections: [
      { id: 'summary', fields: ['name', 'form5bSiteId', 'siteType', 'timeZone'] },
      {
        id: 'address',
        fields: ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode'],
      },
      { id: 'scope', fields: ['validFrom', 'validTo'] },
    ],
    tabs: ['evidence', 'tasks', 'comments', 'history'],
  },
  history: { categories: ['mutation'] },
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
    'views',
  ],
  siteScope: { self: true },
  requirementIds: [],
  catalogPending:
    'Form 5B scope requirements (Compliance Manual ch. 4, 6) are not compiled in the catalog yet',
  readinessFields: ['validFrom', 'validTo'],
  import: {
    enabled: true,
    naturalKey: ['form5bSiteId'],
    headers: {
      name: ['Site name', 'Nombre del sitio'],
      form5bSiteId: ['Form 5B site ID', 'ID del sitio (Formulario 5B)'],
      siteType: ['Site type', 'Tipo de sitio'],
      addressLine1: ['Address', 'Dirección'],
      addressLine2: ['Address line 2', 'Dirección (línea 2)'],
      city: ['City', 'Ciudad'],
      postalCode: ['ZIP code', 'Código postal'],
      timeZone: ['Time zone', 'Zona horaria'],
      validFrom: ['In scope from', 'En el alcance desde'],
      validTo: ['In scope until', 'En el alcance hasta'],
    },
  },
  archiveBlockedBy: ['active_role_assignment', 'active_requirement_instance'],
  archivable: true,
  versioned: true,
  fixture: 'site',
  supportReadable: true,
  publicRecord: 'likely',
  comments: true,
});
