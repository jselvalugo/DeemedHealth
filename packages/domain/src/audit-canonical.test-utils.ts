import type { AuditRowExport } from './audit-canonical.js';

/**
 * Golden row. The @deemed/db integration test feeds the same values to the SQL
 * serializer audit.canonical_text() and expects exactly GOLDEN_CANONICAL.
 */
export const GOLDEN_ROW: AuditRowExport = {
  id: '01923b8e-7c00-7000-8000-000000000001',
  organization_id: '0a7e5f00-0000-4000-8000-000000000001',
  chain_seq: 2,
  occurred_at: '2026-09-27T14:03:11.123456Z',
  category: 'mutation',
  action: 'task.update',
  outcome: 'success',
  actor_type: 'user',
  actor_person_id: '0a7e5f00-0000-4000-8000-0000000000a1',
  actor_user_id: '0a7e5f00-0000-4000-8000-0000000000b1',
  actor_label: 'María "Mari" Delgado\n',
  on_behalf_of_id: null,
  session_id: null,
  request_id: '0a7e5f00-0000-4000-8000-0000000000c1',
  ip_address: '192.0.2.10',
  user_agent: null,
  site_id: null,
  target_table: 'task',
  target_id: '0a7e5f00-0000-4000-8000-0000000000d1',
  requirement_ids: ['CM-05-C&P-LIP-LICENSURE'],
  reason: null,
  diff: {
    fields: { status: { before: 'open', after: 'done' }, score: { before: 1.5, after: 100 } },
  },
  metadata: { z: true, a: [1, null, 'x'] },
  schema_version: 1,
  prev_hash: 'ab'.repeat(32),
  row_hash: 'ignored-by-the-canonical-form',
};

export const GOLDEN_CANONICAL =
  '{"action":"task.update","actor_label":"María \\"Mari\\" Delgado\\n",' +
  '"actor_person_id":"0a7e5f00-0000-4000-8000-0000000000a1",' +
  '"actor_type":"user","actor_user_id":"0a7e5f00-0000-4000-8000-0000000000b1",' +
  '"category":"mutation","chain_seq":2,' +
  '"diff":{"fields":{"score":{"after":100,"before":1.5},"status":{"after":"done","before":"open"}}},' +
  '"id":"01923b8e-7c00-7000-8000-000000000001","ip_address":"192.0.2.10",' +
  '"metadata":{"a":[1,null,"x"],"z":true},"occurred_at":"2026-09-27T14:03:11.123456Z",' +
  '"on_behalf_of_id":null,"organization_id":"0a7e5f00-0000-4000-8000-000000000001",' +
  '"outcome":"success","prev_hash":"' +
  'ab'.repeat(32) +
  '","reason":null,"request_id":"0a7e5f00-0000-4000-8000-0000000000c1",' +
  '"requirement_ids":["CM-05-C&P-LIP-LICENSURE"],"schema_version":1,"session_id":null,' +
  '"site_id":null,"target_id":"0a7e5f00-0000-4000-8000-0000000000d1","target_table":"task",' +
  '"user_agent":null}';
