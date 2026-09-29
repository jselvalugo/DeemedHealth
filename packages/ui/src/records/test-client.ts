// Test helpers for the records components (excluded from the package build).
import type { RecordGetResponse, RecordListResponse, RecordView } from '@deemed/domain';
import { vi } from 'vitest';
import type { RecordsClient, RecordsResult } from './client.js';

export const SITE_ID = 'd0000001-0002-4000-8000-000000000001';
export const SITE2_ID = 'd0000001-0002-4000-8000-000000000002';
export const PERSON_ID = 'd0000001-0003-4000-8000-000000000006';

export function site(
  id = SITE_ID,
  over: Partial<RecordView['fields']> = {},
  archivedAt: string | null = null,
): RecordView {
  return {
    id,
    rowVersion: 3,
    archivedAt,
    fields: {
      name: id === SITE_ID ? 'XYZ-S1 Main' : 'XYZ-S2 East',
      form5bSiteId: 'TEST-5B-0001',
      siteType: 'service_delivery',
      addressLine1: '100 Example Health Way',
      addressLine2: null,
      city: 'Orlando',
      state: 'FL',
      postalCode: '32801',
      timeZone: 'America/New_York',
      validFrom: '2020-01-01',
      validTo: null,
      isTestRecord: true,
      createdAt: '2026-01-05T14:00:00.000Z',
      updatedAt: '2026-01-05T14:00:00.000Z',
      ...over,
    },
  };
}

export function person(): RecordView {
  return {
    id: PERSON_ID,
    rowVersion: 1,
    archivedAt: null,
    fields: {
      givenName: 'Priya',
      familyName: 'Raman',
      preferredName: null,
      workEmail: 'priya.raman@xyz-chc.example',
      npi: '1000001010',
      dob: { masked: true, hasValue: true },
      homeAddress: { masked: true, hasValue: false },
      isTestRecord: true,
      createdAt: '2026-01-05T14:00:00.000Z',
      updatedAt: '2026-01-05T14:00:00.000Z',
    },
  };
}

export function listOf(
  type: string,
  items: RecordView[],
  total = items.length,
): RecordListResponse {
  return { recordType: type, items, nextCursor: null, total, limit: 25 };
}

export function getOf(
  type: string,
  record: RecordView,
  allowedActions: RecordGetResponse['allowedActions'] = ['update', 'archive', 'history'],
  revealable: string[] = [],
): RecordGetResponse {
  return { recordType: type, record, allowedActions, revealable };
}

const ok = <T>(data: T): Promise<RecordsResult<T>> => Promise.resolve({ ok: true, data });

/** A client whose every method is a vi.fn with harmless defaults. */
export function fakeClient(over: Partial<RecordsClient> = {}): {
  [K in keyof RecordsClient]: ReturnType<typeof vi.fn> & RecordsClient[K];
} {
  const base: RecordsClient = {
    list: (type) => ok(listOf(type, [])),
    get: (type, id) => ok(getOf(type, site(id))),
    create: (type) => ok({ recordType: type, record: site() }),
    update: (type) => ok({ recordType: type, record: site() }),
    archive: (type) => ok({ recordType: type, record: site() }),
    restore: (type) => ok({ recordType: type, record: site() }),
    bulk: () => ok({ bulkId: SITE_ID, results: [] }),
    history: (type, id) => ok({ recordType: type, id, items: [], nextCursor: null }),
    reveal: (_t, _i, field) => ok({ field, value: null }),
    listViews: () => ok({ items: [] }),
    createView: () => Promise.resolve({ ok: false, status: 400, code: 'bad_request' }),
    updateView: () => Promise.resolve({ ok: false, status: 400, code: 'bad_request' }),
  };
  const out = {} as Record<string, unknown>;
  for (const [k, fn] of Object.entries({ ...base, ...over })) out[k] = vi.fn(fn as never);
  return out as never;
}
