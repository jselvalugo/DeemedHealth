/**
 * Generated route tests for the record API (ADR-0014 section 2.9; G1-1, G1-2, G1-3,
 * G1-11): every record route, for every record type, with the four required cases
 * (allowed, denied role, other site, other tenant) and the step-up case where the route
 * needs it. Out-of-scope records answer 404 (their existence does not leak) and the
 * refusal is audited; other tenants' records do not exist (RLS).
 */
import { createHash } from 'node:crypto';
import { bareTable, isListable } from '@deemed/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect } from 'vitest';
import { ctx } from '../../../packages/db/test/helpers.js';
import { defineRecordActionTests, type RecordCase } from './record-tests.js';
import {
  as,
  createPayload,
  eventsFor,
  fresh,
  listAll,
  makeRecord,
  nextSeq,
  scopedSite,
  startWorld,
  stopWorld,
  updatePatch,
  versionOf,
  w,
} from './record-world.js';

beforeAll(async () => {
  if (!ctx.available) return;
  await startWorld();
}, 180_000);

afterAll(async () => {
  await stopWorld();
});

const match = (v: number) => ({ 'if-match': `"${v}"` });

/** 403, and the refusal is in the audit log with outcome denied. */
async function expectDenied(res: LightMyRequestResponse) {
  expect(res.statusCode, res.body).toBe(403);
  expect(res.json().error.code).toBe('forbidden');
  const events = await eventsFor(res);
  expect(events.some((e) => e.outcome === 'denied')).toBe(true);
}

/** 404 for a record outside the viewer's scope, with an audited site-scope refusal. */
async function expectHidden(res: LightMyRequestResponse, id: string) {
  expect(res.statusCode, res.body).toBe(404);
  expect(res.json().error.code).toBe('not_found');
  const events = await eventsFor(res);
  expect(events).toEqual([
    expect.objectContaining({
      outcome: 'denied',
      target_id: id,
      metadata: expect.objectContaining({ reason: 'site_scope' }),
    }),
  ]);
}

/** 404 for another tenant's record: RLS hides it, nothing about it exists here. */
function expectAbsent(res: LightMyRequestResponse) {
  expect(res.statusCode, res.body).toBe(404);
  expect(res.json().error.code).toBe('not_found');
}

const scoped = (c: RecordCase, role: 'reader' | 'writer' | 'exporter' | 'revealer') =>
  as(c.roles[role] as never, { siteId: scopedSite(c.typeId) });
const gulf = (c: RecordCase, role: 'reader' | 'writer' | 'exporter' | 'revealer') =>
  as(c.roles[role] as never, { tenant: 'gulf' });

async function archiveDirectly(c: RecordCase, id: string) {
  await w().api.admin.query(
    `UPDATE ${c.def.table} SET archived_at = now(), archive_reason = 'test setup' WHERE id = $1`,
    [id],
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

defineRecordActionTests('list', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    const reader = await as(c.roles.reader);
    const res = await reader.get(`${c.base}?limit=5`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ recordType: c.typeId, limit: 5 });
    expect(body.total).toBeGreaterThanOrEqual(1);
    // Masked fields are never in a list (ADR-0014 section 4.5).
    for (const item of body.items) {
      for (const f of Object.keys(item.fields)) expect(isListable(c.def, f), f).toBe(true);
    }
    expect(await listAll(reader, c.base)).toContain(id);
    // Reads by ordinary roles are not audited.
    expect(await eventsFor(res)).toEqual([]);
  },
  deniedRole: async (c) => {
    const res = await (await as(c.roles.denied)).get(c.base);
    await expectDenied(res);
    expect((await eventsFor(res))[0]).toMatchObject({
      action: 'access.denied',
      metadata: { reason: 'permission', permission: c.def.access.read },
    });
  },
  otherSite: async (c) => {
    const inScope = await makeRecord(c.typeId, 'A');
    const outOfScope = await makeRecord(c.typeId, 'B');
    const ids = await listAll(await scoped(c, 'reader'), c.base);
    expect(ids).toContain(inScope);
    expect(ids).not.toContain(outOfScope);
  },
  otherTenant: async (c) => {
    const xyzId = await makeRecord(c.typeId, 'A');
    const gulfId = await makeRecord(c.typeId, 'A', 'gulf');
    const ids = await listAll(await gulf(c, 'reader'), c.base);
    expect(ids).toContain(gulfId);
    expect(ids).not.toContain(xyzId);
  },
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

defineRecordActionTests('get', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    const res = await (await as(c.roles.reader)).get(`${c.base}/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.record.id).toBe(id);
    expect(body.recordType).toBe(c.typeId);
    expect(body.allowedActions).toContain('history');
    expect(res.headers.etag).toBe(`"${body.record.rowVersion}"`);
    // Masked fields come back masked, never in clear text.
    for (const [name, f] of Object.entries(c.def.fields)) {
      if (f.reveal) expect(body.record.fields[name]).toEqual({ masked: true, hasValue: false });
    }
  },
  deniedRole: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    await expectDenied(await (await as(c.roles.denied)).get(`${c.base}/${id}`));
  },
  otherSite: async (c) => {
    const reader = await scoped(c, 'reader');
    const inScope = await makeRecord(c.typeId, 'A');
    expect((await reader.get(`${c.base}/${inScope}`)).statusCode).toBe(200);
    const outOfScope = await makeRecord(c.typeId, 'B');
    await expectHidden(await reader.get(`${c.base}/${outOfScope}`), outOfScope);
  },
  otherTenant: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    const res = await (await gulf(c, 'reader')).get(`${c.base}/${id}`);
    expectAbsent(res);
    expect(await eventsFor(res)).toEqual([]);
  },
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

defineRecordActionTests('create', {
  allowed: async (c) => {
    const payload = createPayload(c.typeId, 'A');
    const res = await (await as(c.roles.writer)).post(c.base, payload);
    expect(res.statusCode, res.body).toBe(201);
    const { record } = res.json();
    expect(record.rowVersion).toBe(1);
    for (const [k, v] of Object.entries(payload)) expect(record.fields[k], k).toEqual(v);
    const events = await eventsFor(res);
    expect(events).toEqual([
      expect.objectContaining({
        category: 'mutation',
        action: `${c.typeId}.create`,
        outcome: 'success',
        target_table: bareTable(c.def.table),
        target_id: record.id,
        metadata: expect.objectContaining({ row_version: 1, record_type: c.typeId }),
      }),
    ]);
    // Non-production data is marked synthetic (D9).
    if (c.def.fields.isTestRecord) expect(record.fields.isTestRecord).toBe(true);
  },
  deniedRole: async (c) => {
    await expectDenied(await (await as(c.roles.denied)).post(c.base, createPayload(c.typeId, 'A')));
  },
  otherSite: async (c) => {
    const writer = await scoped(c, 'writer');
    const res = await writer.post(c.base, createPayload(c.typeId, 'B'));
    await expectDenied(res);
    expect((await eventsFor(res))[0]?.metadata).toMatchObject({ reason: 'site_scope' });
    if (c.typeId === 'requirement_instance') {
      // A site-level record inside the writer's own site is allowed.
      expect((await writer.post(c.base, createPayload(c.typeId, 'A'))).statusCode).toBe(201);
    }
  },
  otherTenant: async (c) => {
    // References to another tenant's rows do not exist here (RLS): refused, nothing written.
    const payload = createPayload(c.typeId, 'A');
    const res = await (await gulf(c, 'writer')).post(c.base, payload);
    if (c.typeId === 'requirement_instance') {
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().error.fields).toEqual(expect.arrayContaining(['siteId']));
      return;
    }
    // Without references, the record is created in the caller's own tenant only.
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().record.id as string;
    const { rows } = await w().api.admin.query(
      `SELECT organization_id::text AS o FROM ${c.def.table} WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.o).toBe(w().org.gulf);
    expectAbsent(await (await as(c.roles.reader)).get(`${c.base}/${id}`));
  },
});

// ---------------------------------------------------------------------------
// update (If-Match row version)
// ---------------------------------------------------------------------------

defineRecordActionTests('update', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    const writer = await as(c.roles.writer);
    const patch = updatePatch(c.typeId);
    // No If-Match: 428. A stale one: 409 with the current version.
    expect((await writer.patch(`${c.base}/${id}`, patch)).statusCode).toBe(428);
    const stale = await writer.patch(`${c.base}/${id}`, patch, match(7));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'version_conflict', currentVersion: 1 });

    const res = await writer.patch(`${c.base}/${id}`, patch, match(1));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().record).toMatchObject({ rowVersion: 2, fields: patch });
    expect(res.headers.etag).toBe('"2"');
    const [event] = await eventsFor(res);
    expect(event).toMatchObject({
      action: `${c.typeId}.update`,
      outcome: 'success',
      target_id: id,
      metadata: { row_version: 2 },
    });
    // Only the changed columns are in the diff.
    const changed = Object.keys(patch).map((f) => c.def.fields[f]!.column);
    expect(Object.keys((event!.diff as { fields: object }).fields).sort()).toEqual(changed.sort());
  },
  deniedRole: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    await expectDenied(
      await (await as(c.roles.denied)).patch(`${c.base}/${id}`, updatePatch(c.typeId), match(1)),
    );
  },
  otherSite: async (c) => {
    const writer = await scoped(c, 'writer');
    const outOfScope = await makeRecord(c.typeId, 'B');
    await expectHidden(
      await writer.patch(`${c.base}/${outOfScope}`, updatePatch(c.typeId), match(1)),
      outOfScope,
    );
    expect(await versionOf(c.def, outOfScope)).toBe(1);
    const inScope = await makeRecord(c.typeId, 'A');
    const v = await versionOf(c.def, inScope);
    expect(
      (await writer.patch(`${c.base}/${inScope}`, updatePatch(c.typeId), match(v))).statusCode,
    ).toBe(200);
  },
  otherTenant: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    expectAbsent(
      await (await gulf(c, 'writer')).patch(`${c.base}/${id}`, updatePatch(c.typeId), match(1)),
    );
    expect(await versionOf(c.def, id)).toBe(1);
  },
});

// ---------------------------------------------------------------------------
// archive and restore (soft delete only; reason required on archive)
// ---------------------------------------------------------------------------

defineRecordActionTests('archive', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    const writer = await as(c.roles.writer);
    expect((await writer.post(`${c.base}/${id}/archive`, {}, match(1))).statusCode).toBe(400);
    const reason = `Duplicate entry ${nextSeq()}`;
    const res = await writer.post(`${c.base}/${id}/archive`, { reason }, match(1));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().record.archivedAt).not.toBeNull();
    const [event] = await eventsFor(res);
    expect(event).toMatchObject({
      action: `${c.typeId}.archive`,
      outcome: 'success',
      target_id: id,
    });
    // The free-text reason is in the log only as its length and a keyed digest.
    expect(JSON.stringify(event)).not.toContain(reason);
    const fields = (event!.diff as { fields: Record<string, { after: Record<string, unknown> }> })
      .fields;
    expect(fields.archive_reason?.after).toMatchObject({
      redacted: true,
      length: reason.length,
      digest_key: 'tenant-hkdf-v1',
    });
    // Archived rows leave the default list; archiving twice is a conflict.
    expect(await listAll(writer, c.base)).not.toContain(id);
    expect((await writer.post(`${c.base}/${id}/archive`, { reason }, match(2))).statusCode).toBe(
      409,
    );
  },
  deniedRole: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    await expectDenied(
      await (await as(c.roles.denied)).post(`${c.base}/${id}/archive`, { reason: 'x' }, match(1)),
    );
  },
  otherSite: async (c) => {
    const id = await makeRecord(c.typeId, 'B');
    await expectHidden(
      await (await scoped(c, 'writer')).post(`${c.base}/${id}/archive`, { reason: 'x' }, match(1)),
      id,
    );
  },
  otherTenant: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    expectAbsent(
      await (await gulf(c, 'writer')).post(`${c.base}/${id}/archive`, { reason: 'x' }, match(1)),
    );
    expect(await versionOf(c.def, id)).toBe(1);
  },
});

defineRecordActionTests('restore', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    const writer = await as(c.roles.writer);
    expect((await writer.post(`${c.base}/${id}/restore`, {}, match(1))).statusCode).toBe(409);
    expect(
      (await writer.post(`${c.base}/${id}/archive`, { reason: 'Entered in error' }, match(1)))
        .statusCode,
    ).toBe(200);
    const res = await writer.post(`${c.base}/${id}/restore`, {}, match(2));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().record).toMatchObject({ archivedAt: null, rowVersion: 3 });
    expect((await eventsFor(res))[0]).toMatchObject({
      action: `${c.typeId}.restore`,
      outcome: 'success',
    });
    expect(await listAll(writer, c.base)).toContain(id);
  },
  deniedRole: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    await archiveDirectly(c, id);
    await expectDenied(
      await (await as(c.roles.denied)).post(`${c.base}/${id}/restore`, {}, match(2)),
    );
  },
  otherSite: async (c) => {
    const id = await makeRecord(c.typeId, 'B');
    await archiveDirectly(c, id);
    await expectHidden(
      await (await scoped(c, 'writer')).post(`${c.base}/${id}/restore`, {}, match(2)),
      id,
    );
  },
  otherTenant: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    await archiveDirectly(c, id);
    expectAbsent(await (await gulf(c, 'writer')).post(`${c.base}/${id}/restore`, {}, match(2)));
  },
});

// ---------------------------------------------------------------------------
// bulk (per-row checks, one audit event per row)
// ---------------------------------------------------------------------------

function bulkBody(c: RecordCase, items: { id: string; rowVersion: number }[]) {
  switch (c.typeId) {
    case 'site':
      return { action: 'update', items, fields: { siteType: 'administrative' } };
    case 'requirement_instance':
      return {
        action: 'update',
        items,
        fields: { ownerPersonId: w().people.xyz[2] },
      };
    default:
      return { action: 'archive', items, reason: 'Bulk cleanup of test records' };
  }
}

defineRecordActionTests('bulk', {
  allowed: async (c) => {
    const ids = [await makeRecord(c.typeId, 'new'), await makeRecord(c.typeId, 'new')];
    const body = bulkBody(
      c,
      ids.map((id) => ({ id, rowVersion: 1 })),
    );
    const res = await (await as(c.roles.writer)).post(`${c.base}/bulk`, body);
    expect(res.statusCode, res.body).toBe(200);
    const status = body.action === 'archive' ? 'archived' : 'updated';
    expect(res.json().results).toEqual(ids.map((id) => ({ id, status, rowVersion: 2 })));
    const events = await eventsFor(res);
    expect(events.map((e) => e.target_id).sort()).toEqual([...ids].sort());
    expect(new Set(events.map((e) => e.metadata.bulk_id))).toEqual(new Set([res.json().bulkId]));
    expect(
      events.every((e) => e.action === `${c.typeId}.${body.action}` && e.outcome === 'success'),
    ).toBe(true);
  },
  deniedRole: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    await expectDenied(
      await (await as(c.roles.denied)).post(`${c.base}/bulk`, bulkBody(c, [{ id, rowVersion: 1 }])),
    );
    expect(await versionOf(c.def, id)).toBe(1);
  },
  otherSite: async (c) => {
    const inScope = await makeRecord(c.typeId, c.typeId === 'person' ? 'new' : 'A');
    const outOfScope = await makeRecord(c.typeId, 'B');
    const writer =
      c.typeId === 'person'
        ? await as(c.roles.writer, { siteId: scopedSite(c.typeId) })
        : await scoped(c, 'writer');
    const items = [
      { id: inScope, rowVersion: await versionOf(c.def, inScope) },
      { id: outOfScope, rowVersion: 1 },
    ];
    const res = await writer.post(`${c.base}/bulk`, bulkBody(c, items));
    expect(res.statusCode, res.body).toBe(200);
    const results = res.json().results as { id: string; status: string }[];
    // Out of scope looks like "not found"; the refusal is audited.
    expect(results.find((r) => r.id === outOfScope)?.status).toBe('not_found');
    expect(await versionOf(c.def, outOfScope)).toBe(1);
    const events = await eventsFor(res);
    expect(events.find((e) => e.target_id === outOfScope)).toMatchObject({ outcome: 'denied' });
    if (c.typeId !== 'person') {
      // (A scoped writer cannot archive an organization-wide person.)
      expect(results.find((r) => r.id === inScope)?.status).toMatch(/updated|archived/);
    }
  },
  otherTenant: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    const res = await (
      await gulf(c, 'writer')
    ).post(`${c.base}/bulk`, bulkBody(c, [{ id, rowVersion: 1 }]));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().results).toEqual([{ id, status: 'not_found' }]);
    expect(await versionOf(c.def, id)).toBe(1);
  },
});

// ---------------------------------------------------------------------------
// history (from audit.audit_event, under RLS and the record's scope)
// ---------------------------------------------------------------------------

defineRecordActionTests('history', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'new');
    if (c.def.actions.includes('update')) {
      const writer = await as(c.roles.writer);
      expect(
        (await writer.patch(`${c.base}/${id}`, updatePatch(c.typeId), match(1))).statusCode,
      ).toBe(200);
    }
    const res = await (await as(c.roles.reader)).get(`${c.base}/${id}/history`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ recordType: c.typeId, id });
    if (c.def.actions.includes('update')) {
      expect(body.items[0]).toMatchObject({
        action: `${c.typeId}.update`,
        outcome: 'success',
        category: 'mutation',
      });
      expect(body.items[0].diff.fields).toBeDefined();
    }
  },
  deniedRole: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    await expectDenied(await (await as(c.roles.denied)).get(`${c.base}/${id}/history`));
  },
  otherSite: async (c) => {
    const id = await makeRecord(c.typeId, 'B');
    await expectHidden(await (await scoped(c, 'reader')).get(`${c.base}/${id}/history`), id);
  },
  otherTenant: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    expectAbsent(await (await gulf(c, 'reader')).get(`${c.base}/${id}/history`));
  },
});

// ---------------------------------------------------------------------------
// export (re-authentication; masked fields never exported; one export event)
// ---------------------------------------------------------------------------

const exportBody = { format: 'csv', query: {} };

defineRecordActionTests('export', {
  allowed: async (c) => {
    const id = await makeRecord(c.typeId, 'A');
    const res = await (await fresh(c.roles.exporter)).post(`${c.base}/exports`, exportBody);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain(id);
    expect(res.body).toContain('PREVIEW');
    const sha = createHash('sha256').update(res.body, 'utf8').digest('hex');
    expect(res.headers['x-content-sha256']).toBe(sha);
    const [event] = await eventsFor(res);
    expect(event).toMatchObject({
      category: 'export',
      action: `${c.typeId}.export`,
      metadata: expect.objectContaining({ sha256: sha, format: 'csv', record_type: c.typeId }),
    });
    expect(event!.metadata.row_count).toBeGreaterThan(0);
    // Only listable columns: never a masked or hidden field.
    for (const col of event!.metadata.columns as string[])
      expect(isListable(c.def, col)).toBe(true);
  },
  deniedRole: async (c) => {
    await expectDenied(await (await fresh(c.roles.denied)).post(`${c.base}/exports`, exportBody));
  },
  otherSite: async (c) => {
    const inScope = await makeRecord(c.typeId, 'A');
    const outOfScope = await makeRecord(c.typeId, 'B');
    const client = await fresh(c.roles.exporter, { siteId: scopedSite(c.typeId) });
    const res = await client.post(`${c.base}/exports`, exportBody);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(inScope);
    expect(res.body).not.toContain(outOfScope);
  },
  otherTenant: async (c) => {
    const xyzId = await makeRecord(c.typeId, 'A');
    const res = await (
      await fresh(c.roles.exporter, { tenant: 'gulf' })
    ).post(`${c.base}/exports`, exportBody);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(xyzId);
  },
  reauthRequired: async (c) => {
    await fresh(c.roles.exporter);
    // The step-up is valid for 5 minutes (ADR-0006 rule 5).
    w().api.clock.advance({ minutes: 6 });
    const res = await (await as(c.roles.exporter)).post(`${c.base}/exports`, exportBody);
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json().error.code).toBe('reauth_required');
  },
});

// ---------------------------------------------------------------------------
// import dry run (flag on locally and in CI only; nothing written)
// ---------------------------------------------------------------------------

async function chainHead(tenant: 'xyz' | 'gulf'): Promise<number> {
  const r = await w().api.admin.query<{ s: string }>(
    `SELECT chain_seq::text AS s FROM audit.chain_head WHERE organization_id = $1`,
    [w().org[tenant]],
  );
  return Number(r.rows[0]?.s);
}

/** A CSV with one new record and, when given, one matching an existing natural key. */
function importCsv(c: RecordCase, existingKey?: string): string {
  const row = (values: Record<string, unknown>) =>
    Object.keys(c.def.import.headers)
      .map((f) => (values[f] === null || values[f] === undefined ? '' : String(values[f])))
      .join(',');
  const header = Object.keys(c.def.import.headers).join(',');
  const fresh = createPayload(c.typeId, 'A');
  const lines = [header, row(fresh)];
  if (existingKey)
    lines.push(
      row({ ...createPayload(c.typeId, 'A'), [c.def.import.naturalKey[0]!]: existingKey }),
    );
  return `${lines.join('\n')}\n`;
}

async function naturalKeyOf(c: RecordCase, id: string): Promise<string> {
  const column = c.def.fields[c.def.import.naturalKey[0]!]!.column;
  const r = await w().api.admin.query<{ k: string }>(
    `SELECT ${column} AS k FROM ${c.def.table} WHERE id = $1`,
    [id],
  );
  return r.rows[0]?.k as string;
}

defineRecordActionTests('import', {
  allowed: async (c) => {
    const existing = await makeRecord(c.typeId, 'new');
    const key = await naturalKeyOf(c, existing);
    const before = await chainHead('xyz');
    const count = async () =>
      Number((await w().api.admin.query(`SELECT count(*) AS n FROM ${c.def.table}`)).rows[0].n);
    const rowsBefore = await count();
    const res = await (
      await as(c.roles.writer)
    ).post(`${c.base}/imports`, { csv: importCsv(c, key) });
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json();
    expect(report).toMatchObject({
      dryRun: true,
      refused: null,
      summary: { create: 1, update: 1, error: 0 },
    });
    expect(report.rows[1]).toMatchObject({ action: 'update', id: existing });
    // Nothing is written on a dry run: no row, no audit event.
    expect(await count()).toBe(rowsBefore);
    expect(await chainHead('xyz')).toBe(before);
  },
  deniedRole: async (c) => {
    await expectDenied(
      await (await as(c.roles.denied)).post(`${c.base}/imports`, { csv: importCsv(c) }),
    );
  },
  otherSite: async (c) => {
    const outOfScope = await makeRecord(c.typeId, 'B');
    const key = await naturalKeyOf(c, outOfScope);
    const res = await (
      await scoped(c, 'writer')
    ).post(`${c.base}/imports`, { csv: importCsv(c, key) });
    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json().rows as { action: string; id?: string; errors: { code: string }[] }[];
    // A record outside the scope is never matched (it would not be updated), and these
    // organization-level types cannot be created by a site-scoped writer.
    expect(rows.some((r) => r.id === outOfScope)).toBe(false);
    expect(
      rows.every((r) => r.action === 'error' && r.errors.some((e) => e.code === 'forbidden')),
    ).toBe(true);
  },
  otherTenant: async (c) => {
    const xyzId = await makeRecord(c.typeId, 'new');
    const key = await naturalKeyOf(c, xyzId);
    const res = await (
      await gulf(c, 'writer')
    ).post(`${c.base}/imports`, { csv: importCsv(c, key) });
    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json().rows as { action: string; id?: string }[];
    expect(rows.map((r) => r.action)).toEqual(['create', 'create']);
    expect(rows.some((r) => r.id === xyzId)).toBe(false);
  },
});

// ---------------------------------------------------------------------------
// reveal (step-up, reason, reveal roles, audited; value null until S6 stores one)
// ---------------------------------------------------------------------------

const revealBody = { reasonCode: 'exclusion_screening' };

defineRecordActionTests('reveal', {
  allowed: async (c) => {
    const field = c.meta.field as string;
    const id = await makeRecord(c.typeId, 'A');
    const res = await (
      await fresh(c.roles.revealer!)
    ).post(`${c.base}/${id}/reveal/${field}`, revealBody);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ field, value: null });
    expect(await eventsFor(res)).toEqual([
      expect.objectContaining({
        category: 'reveal',
        action: `${c.typeId}.reveal_${field === 'dob' ? 'dob' : 'home_address'}`,
        outcome: 'success',
        target_id: id,
        metadata: expect.objectContaining({ field, value_present: false }),
      }),
    ]);
  },
  deniedRole: async (c) => {
    const field = c.meta.field as string;
    const id = await makeRecord(c.typeId, 'A');
    await expectDenied(
      await (await fresh(c.roles.denied)).post(`${c.base}/${id}/reveal/${field}`, revealBody),
    );
    // org_admin reads people (admin:read) but is not a reveal role: refused and audited
    // as a denied reveal with a fixed reason (never the caller's text).
    const res = await (
      await fresh('org_admin')
    ).post(`${c.base}/${id}/reveal/${field}`, revealBody);
    expect(res.statusCode).toBe(403);
    expect((await eventsFor(res))[0]).toMatchObject({
      category: 'reveal',
      outcome: 'denied',
      target_id: id,
    });
  },
  otherSite: async (c) => {
    const field = c.meta.field as string;
    const id = await makeRecord(c.typeId, 'B');
    const client = await fresh(c.roles.revealer!, { siteId: scopedSite(c.typeId) });
    await expectHidden(await client.post(`${c.base}/${id}/reveal/${field}`, revealBody), id);
  },
  otherTenant: async (c) => {
    const field = c.meta.field as string;
    const id = await makeRecord(c.typeId, 'A');
    expectAbsent(
      await (
        await fresh(c.roles.revealer!, { tenant: 'gulf' })
      ).post(`${c.base}/${id}/reveal/${field}`, revealBody),
    );
  },
  reauthRequired: async (c) => {
    const field = c.meta.field as string;
    const id = await makeRecord(c.typeId, 'A');
    await as(c.roles.revealer!);
    w().api.clock.advance({ minutes: 6 });
    const res = await (
      await as(c.roles.revealer!)
    ).post(`${c.base}/${id}/reveal/${field}`, revealBody);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('reauth_required');
  },
});

// ---------------------------------------------------------------------------
// saved views (never widen access)
// ---------------------------------------------------------------------------

const emptyQuery = { filters: [], sort: [] };

async function createView(
  c: RecordCase,
  client: Awaited<ReturnType<typeof as>>,
  extra: Record<string, unknown> = {},
) {
  const res = await client.post(`${c.base}/saved-views`, {
    name: `View ${nextSeq()}`,
    visibility: 'private',
    query: emptyQuery,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; rowVersion: number; owned: boolean };
}

defineRecordActionTests('views.list', {
  allowed: async (c) => {
    const reader = await as(c.roles.reader);
    const view = await createView(c, reader);
    const res = await reader.get(`${c.base}/saved-views`);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: view.id, owned: true })]),
    );
  },
  deniedRole: async (c) => {
    await expectDenied(await (await as(c.roles.denied)).get(`${c.base}/saved-views`));
  },
  otherSite: async (c) => {
    // A view never widens access: a scoped viewer using it still sees only their sites.
    const outOfScope = await makeRecord(c.typeId, 'B');
    const reader = await scoped(c, 'reader');
    const view = await createView(c, reader);
    const ids = await listAll(reader, `${c.base}?view=${view.id}`);
    expect(ids).not.toContain(outOfScope);
  },
  otherTenant: async (c) => {
    const view = await createView(c, await as(c.roles.reader));
    const client = await gulf(c, 'reader');
    const res = await client.get(`${c.base}/saved-views`);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((v: { id: string }) => v.id)).not.toContain(view.id);
    expectAbsent(await client.get(`${c.base}?view=${view.id}`));
  },
});

defineRecordActionTests('views.create', {
  allowed: async (c) => {
    const res = await (
      await as(c.roles.reader)
    ).post(`${c.base}/saved-views`, {
      name: 'Shared view',
      visibility: 'roles',
      sharedRoles: ['compliance_officer'],
      query: { filters: [], sort: [{ field: c.def.list.defaultSort[0]!.field, dir: 'desc' }] },
      columns: [...c.def.list.defaultColumns],
    });
    expect(res.statusCode, res.body).toBe(201);
    // Sharing with roles is a policy change: a permission event besides the mutation.
    expect((await eventsFor(res)).map((e) => [e.category, e.action])).toEqual([
      ['mutation', 'saved_view.create'],
      ['permission', 'saved_view.share'],
    ]);
  },
  deniedRole: async (c) => {
    await expectDenied(
      await (
        await as(c.roles.denied)
      ).post(`${c.base}/saved-views`, { name: 'x', visibility: 'private', query: emptyQuery }),
    );
  },
  otherSite: async (c) => {
    // A scoped viewer's view that asks for everything still returns only their sites.
    const inScope = await makeRecord(c.typeId, 'A');
    const outOfScope = await makeRecord(c.typeId, 'B');
    const reader = await scoped(c, 'reader');
    const view = await createView(c, reader);
    const ids = await listAll(reader, `${c.base}?view=${view.id}`);
    expect(ids).toContain(inScope);
    expect(ids).not.toContain(outOfScope);
  },
  otherTenant: async (c) => {
    const view = await createView(c, await gulf(c, 'reader'));
    const res = await (await as(c.roles.reader)).get(`${c.base}/saved-views`);
    expect(res.json().items.map((v: { id: string }) => v.id)).not.toContain(view.id);
  },
});

defineRecordActionTests('views.update', {
  allowed: async (c) => {
    const reader = await as(c.roles.reader);
    const view = await createView(c, reader);
    expect(
      (await reader.patch(`${c.base}/saved-views/${view.id}`, { name: 'Renamed' })).statusCode,
    ).toBe(428);
    const res = await reader.patch(
      `${c.base}/saved-views/${view.id}`,
      { name: 'Renamed' },
      match(1),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Renamed', rowVersion: 2 });
    expect((await eventsFor(res))[0]).toMatchObject({
      action: 'saved_view.update',
      outcome: 'success',
    });
    const gone = await reader.patch(
      `${c.base}/saved-views/${view.id}`,
      { archived: true },
      match(2),
    );
    expect(gone.statusCode).toBe(200);
    expect(
      (await reader.get(`${c.base}/saved-views`)).json().items.map((v: { id: string }) => v.id),
    ).not.toContain(view.id);
  },
  deniedRole: async (c) => {
    const view = await createView(c, await as(c.roles.reader));
    await expectDenied(
      await (
        await as(c.roles.denied)
      ).patch(`${c.base}/saved-views/${view.id}`, { name: 'x' }, match(1)),
    );
  },
  otherSite: async (c) => {
    // Another user of the same tenant cannot change a view they do not own: a private one
    // does not exist for them; one shared with their role is refused.
    const owner = await as(c.roles.reader);
    const other = await scoped(c, 'reader');
    const priv = await createView(c, owner);
    expectAbsent(await other.patch(`${c.base}/saved-views/${priv.id}`, { name: 'x' }, match(1)));
    const shared = await createView(c, await as('compliance_officer'), {
      visibility: 'roles',
      sharedRoles: [c.roles.reader],
    });
    const res = await other.patch(`${c.base}/saved-views/${shared.id}`, { name: 'x' }, match(1));
    await expectDenied(res);
  },
  otherTenant: async (c) => {
    const view = await createView(c, await as(c.roles.reader));
    expectAbsent(
      await (
        await gulf(c, 'reader')
      ).patch(`${c.base}/saved-views/${view.id}`, { name: 'x' }, match(1)),
    );
  },
});
