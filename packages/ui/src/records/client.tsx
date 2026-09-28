'use client';

/**
 * The records client contract (ADR-0014 section 2, as seen from the UI). The components
 * in this folder never call `fetch` and never decide access: they call a `RecordsClient`
 * and render what it returns (`allowedActions`, `revealable`, error codes). apps/web
 * provides two implementations: HTTP against apps/api (`/api/records/...`) and, in
 * non-production previews without a database, a synthetic in-memory adapter.
 */
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import type {
  ApiErrorCode,
  BulkRequest,
  BulkResponse,
  FilterOp,
  HistoryResponse,
  RecordGetResponse,
  RecordListResponse,
  RecordView,
  RevealRequest,
  RevealResponse,
  SavedView,
  SavedViewCreate,
  SavedViewListResponse,
  SavedViewUpdate,
} from '@deemed/domain';
import type { Locale } from '@deemed/i18n';
import type { TimeZone } from '@deemed/dates';
import type { LinkComponent } from '../shell/types.js';

export type RecordsErrorCode = ApiErrorCode | 'network';

export type RecordsError = {
  ok: false;
  status: number;
  code: RecordsErrorCode;
  /** Validation and conflicts: field paths, never values. */
  fields?: string[] | undefined;
  /** `version_conflict`: the record's current row version. */
  currentVersion?: number | undefined;
};

export type RecordsResult<T> = { ok: true; data: T } | RecordsError;

export type ListFilterInput = { field: string; op: FilterOp; value: string | readonly string[] };

export type ArchivedMode = 'exclude' | 'only' | 'include';

export type ListParams = {
  filters: readonly ListFilterInput[];
  sort: readonly { field: string; dir: 'asc' | 'desc' }[];
  q: string;
  limit: number;
  cursor: string | null;
  archived: ArchivedMode;
};

export type RecordMutation = { recordType: string; record: RecordView };

export interface RecordsClient {
  list(type: string, params: ListParams): Promise<RecordsResult<RecordListResponse>>;
  get(type: string, id: string): Promise<RecordsResult<RecordGetResponse>>;
  create(type: string, fields: Record<string, unknown>): Promise<RecordsResult<RecordMutation>>;
  update(
    type: string,
    id: string,
    rowVersion: number,
    fields: Record<string, unknown>,
  ): Promise<RecordsResult<RecordMutation>>;
  archive(
    type: string,
    id: string,
    rowVersion: number,
    reason: string,
  ): Promise<RecordsResult<RecordMutation>>;
  restore(type: string, id: string, rowVersion: number): Promise<RecordsResult<RecordMutation>>;
  bulk(type: string, body: BulkRequest): Promise<RecordsResult<BulkResponse>>;
  history(type: string, id: string, cursor: string | null): Promise<RecordsResult<HistoryResponse>>;
  /** Step-up (re-authentication) is the client's job: it retries once after the dialog. */
  reveal(
    type: string,
    id: string,
    field: string,
    body: RevealRequest,
  ): Promise<RecordsResult<RevealResponse>>;
  listViews(type: string): Promise<RecordsResult<SavedViewListResponse>>;
  createView(type: string, body: SavedViewCreate): Promise<RecordsResult<SavedView>>;
  updateView(
    type: string,
    viewId: string,
    rowVersion: number,
    body: SavedViewUpdate,
  ): Promise<RecordsResult<SavedView>>;
}

/**
 * The list query string of `GET /api/records/:type` (ADR-0014 section 2.1):
 * `filter[<field>][<op>]=<value>` (`in` and `between` comma-joined), `sort=a,-b`, `q`,
 * `limit`, `cursor`, `archived`. Both clients send exactly this.
 */
export function listQuery(p: ListParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of p.filters) {
    out[`filter[${f.field}][${f.op}]`] = typeof f.value === 'string' ? f.value : f.value.join(',');
  }
  if (p.sort.length > 0) {
    out.sort = p.sort.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',');
  }
  const q = p.q.trim();
  if (q) out.q = q;
  out.limit = String(p.limit);
  if (p.cursor) out.cursor = p.cursor;
  if (p.archived !== 'exclude') out.archived = p.archived;
  return out;
}

export type RecordsContextValue = {
  client: RecordsClient;
  locale: Locale;
  /** The health center's time zone: timestamps and date filters use it. */
  timeZone: TimeZone;
  Link: LinkComponent;
  navigate: (route: string) => void;
  /** Titles of referenced records (owner, site, account), cached per page view. */
  refTitles: Map<string, Promise<string | null>>;
};

const RecordsContext = createContext<RecordsContextValue | null>(null);

export function RecordsProvider({
  client,
  locale,
  timeZone,
  Link,
  navigate,
  children,
}: Omit<RecordsContextValue, 'refTitles'> & { children: ReactNode }) {
  const refTitles = useRef(new Map<string, Promise<string | null>>());
  const value = useMemo(
    () => ({ client, locale, timeZone, Link, navigate, refTitles: refTitles.current }),
    [client, locale, timeZone, Link, navigate],
  );
  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

export function useRecords(): RecordsContextValue {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error('Records components must be inside <RecordsProvider>');
  return ctx;
}
