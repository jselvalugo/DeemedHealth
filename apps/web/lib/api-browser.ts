/**
 * Browser calls to apps/api on the same origin (/api/*). Cookies travel automatically
 * (HttpOnly; the page never sees the session token); mutations carry the CSRF token
 * from /api/me.
 */
import { ApiErrorBody, type ApiErrorCode } from '@deemed/domain';

export type BrowserResult<T> =
  { ok: true; data: T } | { ok: false; status: number; code: ApiErrorCode | 'network' };

export async function apiPost<T = unknown>(
  path: string,
  body: unknown = {},
  csrfToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: 'network' };
  }
  if (res.status === 204) return { ok: true, data: null as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const error = ApiErrorBody.safeParse(json);
  return {
    ok: false,
    status: res.status,
    code: error.success ? error.data.error.code : 'internal',
  };
}
