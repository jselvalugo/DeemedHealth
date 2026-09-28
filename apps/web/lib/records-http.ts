/**
 * The records client against apps/api (ADR-0014 section 2): `/api/records/:type/...` on
 * the same origin. Every change sends `If-Match: "<rowVersion>"`; the ApiProvider adds
 * the CSRF token and runs step-up when the API answers `reauth_required` (reveal).
 * Responses are parsed with the shared contracts (ADR-0001: zod in packages/domain).
 */
import {
  BulkResponse,
  HistoryResponse,
  RecordGetResponse,
  RecordListResponse,
  RecordView,
  RevealResponse,
  SavedView,
  SavedViewListResponse,
} from '@deemed/domain';
import { listQuery, type RecordsClient } from '@deemed/ui';
import { z, type ZodType, type ZodTypeDef } from 'zod';
import type { Api } from '../app/(app)/reauth';
import type { BrowserResult } from './api-browser';

const enc = encodeURIComponent;
const Mutation = z.object({ recordType: z.string(), record: RecordView });

function base(type: string): string {
  return `/api/records/${enc(type)}`;
}

function ifMatch(rowVersion: number): Record<string, string> {
  return { 'if-match': `"${rowVersion}"` };
}

async function parsed<T>(
  call: Promise<BrowserResult<unknown>>,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<BrowserResult<T>> {
  const res = await call;
  if (!res.ok) return res;
  const out = schema.safeParse(res.data);
  return out.success ? { ok: true, data: out.data } : { ok: false, status: 502, code: 'internal' };
}

export function httpRecordsClient(api: Api): RecordsClient {
  return {
    list: (type, params) => {
      const qs = new URLSearchParams(listQuery(params)).toString();
      return parsed(api.request('GET', `${base(type)}${qs ? `?${qs}` : ''}`), RecordListResponse);
    },
    get: (type, id) => parsed(api.request('GET', `${base(type)}/${enc(id)}`), RecordGetResponse),
    create: (type, fields) => parsed(api.request('POST', base(type), { body: fields }), Mutation),
    update: (type, id, rowVersion, fields) =>
      parsed(
        api.request('PATCH', `${base(type)}/${enc(id)}`, {
          body: fields,
          headers: ifMatch(rowVersion),
        }),
        Mutation,
      ),
    archive: (type, id, rowVersion, reason) =>
      parsed(
        api.request('POST', `${base(type)}/${enc(id)}/archive`, {
          body: { reason },
          headers: ifMatch(rowVersion),
        }),
        Mutation,
      ),
    restore: (type, id, rowVersion) =>
      parsed(
        api.request('POST', `${base(type)}/${enc(id)}/restore`, {
          body: {},
          headers: ifMatch(rowVersion),
        }),
        Mutation,
      ),
    bulk: (type, body) => parsed(api.request('POST', `${base(type)}/bulk`, { body }), BulkResponse),
    history: (type, id, cursor) =>
      parsed(
        api.request(
          'GET',
          `${base(type)}/${enc(id)}/history${cursor ? `?cursor=${enc(cursor)}` : ''}`,
        ),
        HistoryResponse,
      ),
    reveal: (type, id, field, body) =>
      parsed(
        api.request('POST', `${base(type)}/${enc(id)}/reveal/${enc(field)}`, { body }),
        RevealResponse,
      ),
    listViews: (type) =>
      parsed(api.request('GET', `${base(type)}/saved-views`), SavedViewListResponse),
    createView: (type, body) =>
      parsed(api.request('POST', `${base(type)}/saved-views`, { body }), SavedView),
    updateView: (type, viewId, rowVersion, body) =>
      parsed(
        api.request('PATCH', `${base(type)}/saved-views/${enc(viewId)}`, {
          body,
          headers: ifMatch(rowVersion),
        }),
        SavedView,
      ),
  };
}
