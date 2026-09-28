import { describe, expect, it } from 'vitest';
import type { RecordGetResponse, RecordListResponse } from '@deemed/domain';
import { runOp, seedStore, type DemoViewer, type RunContext } from './engine';
import {
  buildStore,
  decodeJournal,
  encodeJournal,
  JOURNAL_MAX_BYTES,
  type JournalEntry,
} from './journal';
import { PERSON_IDS, SITE_IDS } from './seed';

const officer: DemoViewer = {
  id: 'demo-compliance',
  name: 'Dana Rivera',
  roles: ['compliance_officer'],
};
const coordinator: DemoViewer = {
  id: 'demo-coordinator',
  name: 'Luis Moreno',
  roles: ['credentialing_coordinator'],
};
const NOW = '2026-09-28T15:00:00.000Z';
const ID = '0e4f0a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const ID2 = '1e4f0a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

function ctx(over: Partial<RunContext> = {}): RunContext {
  return { viewer: officer, now: NOW, ids: [ID, ID2], stepUpAt: null, ...over };
}

const S4 = SITE_IDS[3] as string;
const S1 = SITE_IDS[0] as string;
const RAMAN = PERSON_IDS['priya.raman'] as string;

describe('demo records engine', () => {
  it('lists with the API query language: filters, search, sort, and cursor paging', () => {
    const store = seedStore();
    const central = runOp(
      store,
      {
        op: 'list',
        type: 'site',
        query: { 'filter[timeZone][eq]': 'America/Chicago' },
      },
      ctx(),
    );
    expect(
      central.ok && (central.data as RecordListResponse).items.map((r) => r.fields.name),
    ).toEqual(['XYZ-S3 Panhandle']);
    const page1 = runOp(
      store,
      { op: 'list', type: 'person', query: { limit: '4', sort: 'familyName' } },
      ctx(),
    );
    expect(page1.ok).toBe(true);
    const data = (page1 as { data: RecordListResponse }).data;
    expect(data.total).toBe(9);
    expect(data.items).toHaveLength(4);
    // Masked fields are never in a list.
    expect(data.items[0]?.fields).not.toHaveProperty('dob');
    const page2 = runOp(
      store,
      {
        op: 'list',
        type: 'person',
        query: { limit: '4', sort: 'familyName', cursor: data.nextCursor ?? '' },
      },
      ctx(),
    );
    expect((page2 as { data: RecordListResponse }).data.items[0]?.fields.familyName).not.toBe(
      data.items[0]?.fields.familyName,
    );
    const bad = runOp(
      store,
      { op: 'list', type: 'site', query: { 'filter[dob][eq]': 'x' } },
      ctx(),
    );
    expect(bad).toMatchObject({ ok: false, code: 'bad_request' });
    const search = runOp(store, { op: 'list', type: 'site', query: { q: 'panhandle' } }, ctx());
    expect((search as { data: RecordListResponse }).data.total).toBe(1);
  });

  it('denies what the role does not allow, like the API', () => {
    const store = seedStore();
    expect(
      runOp(store, { op: 'list', type: 'site', query: {} }, ctx({ viewer: coordinator })),
    ).toMatchObject({
      ok: false,
      status: 403,
      code: 'forbidden',
    });
    // Managed-elsewhere types have no generic create route.
    expect(runOp(store, { op: 'create', type: 'user_account', fields: {} }, ctx())).toMatchObject({
      code: 'not_found',
    });
    const got = runOp(
      store,
      { op: 'get', type: 'user_account', id: 'd0000001-0004-4000-8000-000000000001' },
      ctx(),
    );
    expect((got as { data: RecordGetResponse }).data.allowedActions).toEqual(['history']);
  });

  it('refuses a stale If-Match with 409 and names the fields that changed', () => {
    const store = seedStore();
    const first = runOp(
      store,
      {
        op: 'update',
        type: 'site',
        id: S4,
        version: 1,
        fields: { city: 'Kissimmee', postalCode: '34741' },
      },
      ctx(),
    );
    expect(first.ok).toBe(true);
    const stale = runOp(
      store,
      { op: 'update', type: 'site', id: S4, version: 1, fields: { addressLine2: 'Bay 3' } },
      ctx(),
    );
    expect(stale).toEqual({
      ok: false,
      status: 409,
      code: 'version_conflict',
      fields: ['city', 'postalCode'],
      currentVersion: 2,
    });
    const invalid = runOp(
      store,
      { op: 'update', type: 'site', id: S4, version: 2, fields: { postalCode: '90210' } },
      ctx(),
    );
    expect(invalid).toMatchObject({ code: 'bad_request', fields: ['postalCode'] });
  });

  it('archives with a reason, refuses blocked records, restores, and records history', () => {
    const store = seedStore();
    expect(
      runOp(
        store,
        { op: 'archive', type: 'site', id: S1, version: 1, body: { reason: 'Closing' } },
        ctx(),
      ),
    ).toMatchObject({
      code: 'conflict',
      fields: ['blockedBy.active_role_assignment', 'blockedBy.active_requirement_instance'],
    });
    expect(
      runOp(store, { op: 'archive', type: 'site', id: S4, version: 1, body: {} }, ctx()),
    ).toMatchObject({
      code: 'bad_request',
    });
    expect(
      runOp(
        store,
        { op: 'archive', type: 'site', id: S4, version: 1, body: { reason: 'Retired' } },
        ctx(),
      ).ok,
    ).toBe(true);
    const listed = runOp(store, { op: 'list', type: 'site', query: {} }, ctx());
    expect((listed as { data: RecordListResponse }).data.total).toBe(3);
    expect(
      runOp(store, { op: 'restore', type: 'site', id: S4, version: 2, body: {} }, ctx()).ok,
    ).toBe(true);
    const history = runOp(store, { op: 'history', type: 'site', id: S4, cursor: null }, ctx());
    expect(
      history.ok && (history.data as { items: { action: string }[] }).items.map((e) => e.action),
    ).toEqual(['site.restore', 'site.archive', 'site.create']);
  });

  it('reveals a masked value only after step-up, and audits it with the reason code', () => {
    const store = seedStore();
    const body = { reasonCode: 'credentialing_verification' };
    const noStepUp = runOp(
      store,
      { op: 'reveal', type: 'person', id: RAMAN, field: 'dob', body },
      ctx(),
    );
    expect(noStepUp).toMatchObject({ ok: false, status: 401, code: 'reauth_required' });
    const stale = runOp(
      store,
      { op: 'reveal', type: 'person', id: RAMAN, field: 'dob', body },
      ctx({ stepUpAt: Date.parse(NOW) - 6 * 60 * 1000 }),
    );
    expect(stale).toMatchObject({ code: 'reauth_required' });
    const ok = runOp(
      store,
      { op: 'reveal', type: 'person', id: RAMAN, field: 'dob', body },
      ctx({ stepUpAt: Date.parse(NOW) - 60 * 1000 }),
    );
    expect(ok).toEqual({ ok: true, data: { field: 'dob', value: '1985-03-14' } });
    const history = runOp(store, { op: 'history', type: 'person', id: RAMAN, cursor: null }, ctx());
    expect(
      history.ok &&
        (history.data as { items: { action: string; reason: string | null }[] }).items[0],
    ).toMatchObject({
      action: 'person.reveal_dob',
      reason: 'credentialing_verification',
    });
  });

  it('shows someone else’s shared view without its filter values', () => {
    const store = seedStore();
    const views = runOp(store, { op: 'views.list', type: 'site' }, ctx());
    const view = (views as { data: { items: { owned: boolean; query: { filters: object[] } }[] } })
      .data.items[0];
    expect(view?.owned).toBe(false);
    expect(view?.query.filters).toEqual([{ field: 'timeZone', op: 'eq' }]);
  });

  it('replays the journal from the cookie, and drops the oldest changes past the size cap', () => {
    const entries: JournalEntry[] = [
      {
        o: {
          op: 'update',
          type: 'site',
          id: S4,
          version: 1,
          fields: { city: 'Kissimmee', postalCode: '34741' },
        },
        a: NOW,
        u: officer.id,
        i: [ID, ID2],
      },
    ];
    const text = encodeJournal(entries);
    const store = buildStore(decodeJournal(text), (id) =>
      id === officer.id ? officer : undefined,
    );
    const got = runOp(store, { op: 'get', type: 'site', id: S4 }, ctx());
    expect((got as { data: RecordGetResponse }).data.record.fields.city).toBe('Kissimmee');
    expect(decodeJournal('not-json')).toEqual([]);
    const many = Array.from({ length: 60 }, () => entries[0] as JournalEntry);
    expect(encodeJournal(many).length).toBeLessThanOrEqual(JOURNAL_MAX_BYTES);
  });
});
