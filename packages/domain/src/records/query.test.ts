import { describe, expect, it } from 'vitest';
import { getRecordType } from './registry.js';
import { checkStoredQuery, parseFilterKey, parseListQuery, queryFingerprint } from './query.js';

const site = getRecordType('site');
const ri = getRecordType('requirement_instance');
const person = getRecordType('person');

describe('list query', () => {
  it('uses the default sort and limit', () => {
    const r = parseListQuery(site, {});
    expect(r).toEqual({
      ok: true,
      value: {
        filters: [],
        sort: [{ field: 'name', dir: 'asc' }],
        q: null,
        limit: 50,
        cursor: null,
        archived: 'exclude',
        view: null,
      },
    });
  });

  it('parses typed filters, sort, and search', () => {
    const r = parseListQuery(ri, {
      'filter[status][in]': 'overdue,due_soon',
      'filter[nextDueOn][between]': '2026-01-01,2026-12-31',
      'filter[ownerPersonId][is_null]': 'false',
      sort: '-nextDueOn,requirementId',
      q: 'CM-05-C&P-LIP-LICENSURE',
      limit: '200',
    });
    expect(r.ok && r.value).toMatchObject({
      filters: [
        { field: 'status', op: 'in', value: ['overdue', 'due_soon'] },
        { field: 'nextDueOn', op: 'between', value: ['2026-01-01', '2026-12-31'] },
        { field: 'ownerPersonId', op: 'is_null', value: false },
      ],
      sort: [
        { field: 'nextDueOn', dir: 'desc' },
        { field: 'requirementId', dir: 'asc' },
      ],
      limit: 200,
    });
  });

  it('refuses unknown or unfilterable fields, bad operators and values, and says where only', () => {
    const bad = parseListQuery(site, {
      'filter[city][eq]': 'Tampa',
      'filter[siteType][eq]': 'castle',
      'filter[validFrom][between]': '2026-12-31,2026-01-01',
      'filter[name][lt]': 'M',
      sort: 'city',
      limit: '500',
      archived: 'all',
      unknown: 'x',
    });
    expect(bad).toEqual({
      ok: false,
      fields: expect.arrayContaining([
        'filter.city',
        'filter.siteType',
        'filter.validFrom',
        'filter.name',
        'sort',
        'limit',
        'archived',
        'query',
      ]),
    });
  });

  it('never filters, sorts, or searches a masked field (person.dob)', () => {
    expect(parseListQuery(person, { 'filter[dob][eq]': '1980-01-01' }).ok).toBe(false);
    expect(parseListQuery(person, { sort: 'dob' }).ok).toBe(false);
  });

  it('rejects SSN-shaped search text and filter values (D1)', () => {
    const shaped = ['123', '45', '6789'].join('-');
    expect(parseListQuery(person, { q: shaped }).ok).toBe(false);
    expect(parseListQuery(person, { 'filter[npi][eq]': shaped }).ok).toBe(false);
  });

  it('refuses a repeated parameter and an archived mode on a type without archive', () => {
    expect(parseListQuery(site, { q: ['a', 'b'] }).ok).toBe(false);
    expect(parseListQuery(getRecordType('role_assignment'), { archived: 'include' }).ok).toBe(
      false,
    );
  });

  it('parses filter keys with a loop', () => {
    expect(parseFilterKey('filter[siteType][eq]')).toEqual(['siteType', 'eq']);
    expect(parseFilterKey('filter[a][b][c]')).toBeNull();
    expect(parseFilterKey('filter[site_type][eq]')).toBeNull();
    expect(parseFilterKey('filter[' + '['.repeat(10_000))).toBeNull();
  });

  it('validates stored saved-view queries like the query string', () => {
    expect(
      checkStoredQuery(site, {
        filters: [{ field: 'timeZone', op: 'eq', value: 'America/Chicago' }],
        sort: [{ field: 'name', dir: 'asc' }],
      }).ok,
    ).toBe(true);
    expect(
      checkStoredQuery(person, {
        filters: [{ field: 'dob', op: 'eq', value: '1980-01-01' }],
        sort: [],
      }),
    ).toEqual({ ok: false, fields: ['query.filters.dob'] });
  });

  it('fingerprints a query independently of filter order', () => {
    const a = parseListQuery(ri, {
      'filter[status][eq]': 'met',
      'filter[siteId][is_null]': 'true',
    });
    const b = parseListQuery(ri, {
      'filter[siteId][is_null]': 'true',
      'filter[status][eq]': 'met',
    });
    if (!a.ok || !b.ok) throw new Error('parse failed');
    expect(queryFingerprint('requirement_instance', a.value)).toBe(
      queryFingerprint('requirement_instance', b.value),
    );
  });
});
