/**
 * The registry test (ADR-0014 section 1; phase-1 plan S4b done-when): it fails a type
 * with no site scope, no fixture factory key, an unclassified field, a masked field
 * marked filterable, an SSN-like field or header (D1), or a read-only type with write
 * actions. Negative cases mutate a copy of a real type so each rule is proven to bite.
 */
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../audit-actions.js';
import {
  ArchiveRequest,
  COLUMN_CLASSES,
  RestoreRequest,
  RevealRequest,
  createSchema,
  getRecordType,
  recordAuditActions,
  recordTypes,
  revealAction,
  updateSchema,
  validateRecordType,
  validateRegistry,
  type FieldDef,
  type RecordTypeDef,
} from './index.js';

function variant(id: string, change: (d: RecordTypeDef) => RecordTypeDef): string[] {
  return validateRecordType(change(getRecordType(id)));
}

const withField = (d: RecordTypeDef, name: string, f: Partial<FieldDef>): RecordTypeDef => ({
  ...d,
  fields: { ...d.fields, [name]: { ...(d.fields[name] as FieldDef), ...f } },
});

describe('record type registry', () => {
  it('registers the first S4b types', () => {
    expect(recordTypes().map((t) => t.id)).toEqual([
      'site',
      'person',
      'user_account',
      'role_assignment',
      'requirement_instance',
    ]);
  });

  it('has no problems', () => {
    expect(validateRegistry(recordTypes())).toEqual([]);
  });

  it('classifies every field from the generated data dictionary classes', () => {
    for (const def of recordTypes()) {
      for (const [name, f] of Object.entries(def.fields)) {
        expect(COLUMN_CLASSES[def.table]?.columns[f.column], `${def.id}.${name}`).toBeDefined();
      }
    }
  });

  it('registers every derived audit action with the same category', () => {
    for (const a of recordAuditActions(recordTypes())) {
      const registered = (AUDIT_ACTIONS as Record<string, { category: string }>)[a.action];
      expect(registered?.category, a.action).toBe(a.category);
    }
    expect(revealAction('person', 'homeAddress')).toBe('person.reveal_home_address');
    expect(AUDIT_ACTIONS['person.reveal_dob'].category).toBe('reveal');
  });

  it('keeps D15: org_admin data is Administration only, requirement instances are readiness', () => {
    for (const id of ['site', 'person', 'user_account', 'role_assignment']) {
      expect(getRecordType(id).access.read).toBe('admin:read');
    }
    expect(getRecordType('requirement_instance').access.read).toBe('readiness:read');
  });

  describe('fails a type that', () => {
    it('has no site scope', () => {
      expect(variant('site', (d) => ({ ...d, siteScope: undefined as never }))).toContain(
        'site: site scope is not declared',
      );
    });

    it('has no fixture factory key', () => {
      expect(variant('site', (d) => ({ ...d, fixture: '' }))).toContain(
        'site: fixture factory key is required',
      );
    });

    it('has a field with no sensitivity class', () => {
      const problems = variant('site', (d) =>
        withField(d, 'mystery', { column: 'mystery', kind: 'text' }),
      );
      expect(problems).toContain(
        'site: field mystery: column public.site.mystery has no sensitivity class',
      );
    });

    it('marks a masked field filterable, sortable, searchable, or a list column', () => {
      const problems = variant('person', (d) => ({
        ...withField(d, 'dob', { filterable: true, sortable: true, searchable: 'exact' }),
        list: { ...d.list, defaultColumns: [...d.list.defaultColumns, 'dob'] },
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          'person: field dob is masked and cannot be filterable',
          'person: field dob is masked and cannot be sortable',
          'person: field dob is masked and cannot be searchable',
          'person: field dob is masked and cannot be a default list column',
        ]),
      );
    });

    it('makes a masked field importable or editable before field encryption exists', () => {
      const problems = variant('person', (d) =>
        withField(d, 'homeAddress', { importable: true, editable: 'always' }),
      );
      expect(problems).toEqual(
        expect.arrayContaining([
          'person: field homeAddress is masked and cannot be importable',
          'person: field homeAddress is masked and cannot be edited through the generic API until S6',
        ]),
      );
    });

    it('names a field or an import header like an SSN (D1)', () => {
      const field = variant('person', (d) =>
        withField(d, 'ssn', { column: 'given_name', kind: 'text' }),
      );
      expect(field.some((p) => p.includes('looks like an SSN field'))).toBe(true);
      const header = variant('person', (d) => ({
        ...d,
        import: { ...d.import, headers: { ...d.import.headers, npi: ['Social Security No.'] } },
      }));
      expect(header).toContain(
        'person: import header "Social Security No." looks like an SSN (D1)',
      );
    });

    it('is read-only but declares write actions', () => {
      expect(
        variant('user_account', (d) => ({
          ...d,
          readOnly: true,
          actions: [...d.actions, 'create'],
        })),
      ).toContain('user_account: read-only type declares create');
    });

    it('uses a permission of another module or the wrong verb', () => {
      const problems = variant('site', (d) => ({
        ...d,
        access: { ...d.access, update: 'providers:write', export: 'admin:read' },
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          'site: access.update providers:write is not a admin permission',
          'site: access.export admin:read must use export',
        ]),
      );
    });

    it('reveals a field that is not masked, or has no reveal action', () => {
      expect(
        variant('site', (d) =>
          withField(d, 'city', { reveal: { roles: ['compliance_officer'], stepUp: true } }),
        ),
      ).toEqual(
        expect.arrayContaining([
          'site: field city: only masked fields can be revealed',
          'site: has revealable fields but no reveal action',
        ]),
      );
    });

    it('lets users set a derived lifecycle field', () => {
      expect(
        variant('requirement_instance', (d) => withField(d, 'status', { editable: 'always' })),
      ).toContain(
        'requirement_instance: the lifecycle field changes only through transitions and jobs',
      );
    });

    it('is regulatory without requirementIds or a catalog note', () => {
      const problems = variant('site', (d) => {
        const copy = { ...d };
        delete copy.catalogPending;
        return copy;
      });
      expect(problems).toContain(
        'site: declare requirementIds, nonRegulatory: true, or catalogPending',
      );
    });

    it('archives without an archived_at column, or without a row version', () => {
      expect(
        variant('role_assignment', (d) => ({
          ...d,
          actions: [...d.actions, 'archive', 'restore'],
        })),
      ).toContain('role_assignment: archive and restore need an archived_at column (archivable)');
      expect(variant('site', (d) => ({ ...d, versioned: false }))).toContain(
        'site: changes need a row_version column (versioned)',
      );
    });

    it('lists a free-text field anywhere but the record page (security review L3)', () => {
      const problems = variant('role_assignment', (d) => ({
        ...withField(d, 'grantReason', { detailOnly: false, filterable: true }),
        list: { ...d.list, defaultColumns: [...d.list.defaultColumns, 'grantReason'] },
      }));
      expect(problems).toContain(
        'role_assignment: field grantReason: free text must be detail-only',
      );
      const listed = variant('role_assignment', (d) => ({
        ...d,
        list: { ...d.list, defaultColumns: [...d.list.defaultColumns, 'grantReason'] },
      }));
      expect(listed).toContain(
        'role_assignment: field grantReason is detail-only and cannot be a default list column',
      );
    });

    it('shows auth or system events in history, or none at all (security review L1)', () => {
      const auth = variant('user_account', (d) => ({
        ...d,
        history: { categories: ['mutation', 'auth' as never] },
      }));
      expect(auth).toContain('user_account: history category auth is not allowed');
      expect(variant('site', (d) => ({ ...d, history: { categories: [] } }))).toContain(
        'site: history needs at least one audit category',
      );
    });

    it('duplicates an id or a list route', () => {
      const site = getRecordType('site');
      expect(validateRegistry([site, site])).toEqual(
        expect.arrayContaining([
          'site: duplicate record type id',
          'site: duplicate list route admin/org',
        ]),
      );
    });
  });
});

describe('payload schemas', () => {
  const site = getRecordType('site');
  const valid = {
    name: 'Synthetic Site',
    siteType: 'service_delivery',
    addressLine1: '1 Example Way',
    city: 'Tampa',
    postalCode: '33601',
    timeZone: 'America/New_York',
    validFrom: '2026-01-01',
  };

  it('accepts a complete create payload and never the system fields', () => {
    expect(createSchema(site).safeParse(valid).success).toBe(true);
    expect(createSchema(site).safeParse({ ...valid, state: 'FL' }).success).toBe(false);
    expect(createSchema(site).safeParse({ ...valid, isTestRecord: false }).success).toBe(false);
    expect(createSchema(site).safeParse({ ...valid, organizationId: valid.name }).success).toBe(
      false,
    );
  });

  it('applies the rules: required fields, a Florida ZIP (D4), and the valid range', () => {
    const noName: Record<string, string> = { ...valid };
    delete noName.name;
    const paths = (v: unknown) => {
      const r = createSchema(site).safeParse(v);
      return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    };
    expect(paths(noName)).toContain('name');
    expect(paths({ ...valid, postalCode: '30301' })).toContain('postalCode');
    expect(paths({ ...valid, validTo: '2025-12-31' })).toContain('validTo');
  });

  it('updates only fields editable after create, and never an empty change', () => {
    const ri = getRecordType('requirement_instance');
    expect(updateSchema(ri).safeParse({ ownerPersonId: null }).success).toBe(true);
    expect(updateSchema(ri).safeParse({ requirementId: 'CM-05-X' }).success).toBe(false);
    expect(updateSchema(ri).safeParse({ status: 'met' }).success).toBe(false);
    expect(updateSchema(ri).safeParse({}).success).toBe(false);
  });

  it('refuses SSN-shaped text in any create, update, or bulk field (security review L4)', () => {
    const shaped = ['000', '12', '3456'].join('-');
    const create = createSchema(site).safeParse({ ...valid, name: `Clinic ${shaped}` });
    expect(create.success).toBe(false);
    expect(create.error?.issues.map((i) => i.path.join('.'))).toContain('name');
    expect(updateSchema(site).safeParse({ city: shaped }).success).toBe(false);
    expect(updateSchema(site).safeParse({ city: 'Orlando' }).success).toBe(true);
  });

  it('refuses SSN-shaped archive, restore, and reveal reasons (security review L4)', () => {
    const shaped = ['000', '12', '3456'].join('-');
    expect(ArchiveRequest.safeParse({ reason: `Duplicate of ${shaped}` }).success).toBe(false);
    expect(ArchiveRequest.safeParse({ reason: 'Duplicate entry' }).success).toBe(true);
    expect(RestoreRequest.safeParse({ reason: shaped }).success).toBe(false);
    expect(RestoreRequest.safeParse({}).success).toBe(true);
    expect(RevealRequest.safeParse({ reasonCode: 'other', note: shaped }).success).toBe(false);
  });

  it('never accepts an SSN field on a person (strict schemas, D1)', () => {
    const person = getRecordType('person');
    const r = createSchema(person).safeParse({ givenName: 'A', familyName: 'B', ssn: 'x' });
    expect(r.success).toBe(false);
  });
});
