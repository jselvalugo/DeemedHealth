/**
 * Code-side registries that migrations copy into the database must stay identical:
 * the audit action registry (ADR-0008 section 4) and the executive approval areas.
 */
import { AUDIT_ACTIONS, PROPOSED_APPROVAL_AREAS } from '@deemed/domain';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connect, describeDb, need } from './helpers.js';

describeDb('registries in step with @deemed/domain', () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = await connect(need().adminUrl);
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('audit.action_registry equals AUDIT_ACTIONS (action, category, description)', async () => {
    const { rows } = await admin.query<{ action: string; category: string; description: string }>(
      'SELECT action, category, description FROM audit.action_registry ORDER BY action COLLATE "C"',
    );
    const fromCode = Object.entries(AUDIT_ACTIONS)
      .map(([action, e]) => ({ action, category: e.category, description: e.description }))
      .sort((a, b) => (a.action < b.action ? -1 : 1));
    expect(rows).toEqual(fromCode);
  });

  it('public.approval_area equals PROPOSED_APPROVAL_AREAS and is marked proposed', async () => {
    const { rows } = await admin.query<{ key: string; modules: string[]; status: string }>(
      'SELECT key, modules, status FROM public.approval_area ORDER BY key COLLATE "C"',
    );
    expect(Object.fromEntries(rows.map((r) => [r.key, r.modules]))).toEqual(
      Object.fromEntries(Object.entries(PROPOSED_APPROVAL_AREAS).map(([k, v]) => [k, [...v]])),
    );
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['proposed']));
  });
});
