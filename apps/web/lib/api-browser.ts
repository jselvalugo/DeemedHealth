/**
 * Browser calls to apps/api on the same origin (/api/*). Cookies travel automatically
 * (HttpOnly; the page never sees the session token); mutations carry the CSRF token
 * from /api/me.
 */
import { ApiErrorBody, type ApiErrorCode } from '@deemed/domain';

export type BrowserError = {
  ok: false;
  status: number;
  code: ApiErrorCode | 'network';
  /** Validation and conflicts: field paths (never values). */
  fields?: string[] | undefined;
  /** `version_conflict`: the record's current row version. */
  currentVersion?: number | undefined;
};

export type BrowserResult<T> = { ok: true; data: T } | BrowserError;

export type RequestOptions = {
  body?: unknown;
  /** Extra headers, e.g. `If-Match: "<rowVersion>"`. */
  headers?: Record<string, string>;
};

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function apiRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  options: RequestOptions = {},
  csrfToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(csrfToken && MUTATING.has(method) ? { 'x-csrf-token': csrfToken } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(method === 'GET' ? { cache: 'no-store' as const } : {}),
    });
  } catch {
    return { ok: false, status: 0, code: 'network' };
  }
  if (res.status === 204) return { ok: true, data: null as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const error = ApiErrorBody.safeParse(json);
  if (!error.success) return { ok: false, status: res.status, code: 'internal' };
  const e = error.data.error;
  return {
    ok: false,
    status: res.status,
    code: e.code,
    ...(e.fields ? { fields: e.fields } : {}),
    ...(e.currentVersion !== undefined ? { currentVersion: e.currentVersion } : {}),
  };
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown = {},
  csrfToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserResult<T>> {
  return apiRequest<T>('POST', path, { body }, csrfToken, fetchImpl);
}
