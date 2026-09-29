/**
 * The records client for the non-production demo: each call is a server action (see
 * app/(app)/records-demo-actions.ts), with the same step-up flow as the HTTP client.
 */
import { listQuery, type RecordsClient, type RecordsResult } from '@deemed/ui';
import type { Api, StepUpAdapter } from '../../app/(app)/reauth';
import {
  demoRecords,
  demoStepUpPasskey,
  demoStepUpTotp,
} from '../../app/(app)/records-demo-actions';
import type { DemoOp } from './engine';

export function demoRecordsClient(api: Pick<Api, 'withStepUp'>): RecordsClient {
  const call = <T>(op: DemoOp) =>
    api.withStepUp(async () => {
      try {
        return (await demoRecords(op)) as RecordsResult<T>;
      } catch {
        return { ok: false as const, status: 0, code: 'network' as const };
      }
    });
  return {
    list: (type, params) => call({ op: 'list', type, query: listQuery(params) }),
    get: (type, id) => call({ op: 'get', type, id }),
    create: (type, fields) => call({ op: 'create', type, fields }),
    update: (type, id, version, fields) => call({ op: 'update', type, id, version, fields }),
    archive: (type, id, version, reason) =>
      call({ op: 'archive', type, id, version, body: { reason } }),
    restore: (type, id, version, reason) =>
      call({ op: 'restore', type, id, version, body: reason ? { reason } : {} }),
    bulk: (type, body) => call({ op: 'bulk', type, body }),
    history: (type, id, cursor) => call({ op: 'history', type, id, cursor }),
    reveal: (type, id, field, body) => call({ op: 'reveal', type, id, field, body }),
    listViews: (type) => call({ op: 'views.list', type }),
    createView: (type, body) => call({ op: 'views.create', type, body }),
    updateView: (type, viewId, version, body) =>
      call({ op: 'views.update', type, viewId, version, body }),
  };
}

export const demoStepUp: StepUpAdapter = {
  totp: (code) => demoStepUpTotp(code),
  passkey: () => demoStepUpPasskey(),
};
