/**
 * Every registered record type has a fixture factory, and a type whose generic create is
 * on gets a create payload that the server's own schema and rules accept (ADR-0014
 * section 2.9: a type without a fixture factory fails CI). Synthetic only (D1, D9).
 */
import { createFields, createSchema, detectSsnLikeColumns, recordTypes } from '@deemed/domain';
import { describe, expect, it } from 'vitest';
import { isValidNpi } from './npi';
import { RECORD_FIXTURES } from './records';

const refs = {
  n: 7,
  organizationId: '0f000000-0000-4000-8000-000000000001',
  siteId: '0f000000-0000-4000-8000-000000000002',
  personId: '0f000000-0000-4000-8000-000000000003',
  userAccountId: '0f000000-0000-4000-8000-000000000004',
};

describe('record fixture factories', () => {
  it('exist for every registered record type', () => {
    const missing = recordTypes()
      .filter((t) => !RECORD_FIXTURES[t.fixture])
      .map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it('produce fields the type declares, and create payloads its schema accepts', () => {
    for (const def of recordTypes()) {
      const values = RECORD_FIXTURES[def.fixture]!(refs);
      for (const key of Object.keys(values)) expect(def.fields, `${def.id}.${key}`).toHaveProperty(key);
      if (!def.actions.includes('create')) continue;
      const payload = Object.fromEntries(createFields(def).map((f) => [f, values[f]]));
      const parsed = createSchema(def).safeParse(payload);
      expect(parsed.success, `${def.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('are synthetic: test NPIs, example.org emails, no SSN-like field (D1)', () => {
    const person = RECORD_FIXTURES.person!(refs);
    expect(isValidNpi(person.npi)).toBe(true);
    expect(String(person.workEmail).endsWith('@example.org')).toBe(true);
    for (const def of recordTypes()) {
      const names = Object.keys(RECORD_FIXTURES[def.fixture]!(refs)).map((name) => ({ name }));
      expect(detectSsnLikeColumns(names)).toEqual([]);
    }
  });
});
