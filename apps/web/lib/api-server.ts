/**
 * Server-side calls from Next.js to apps/api over HTTP (ADR-0010 section 1): the
 * browser's cookie header is forwarded as is, with a fresh correlation id. apps/web
 * never touches the database.
 *
 * DH_API_URL is the API origin: set at build time on Netlify (netlify.toml maps the
 * deploy URL), and http://localhost:4000 in local development.
 */
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import {
  ApiErrorBody,
  MeResponse,
  NavigationResponse,
  type ApiErrorCode,
  type MeResponse as Me,
  type NavigationResponse as Navigation,
} from '@deemed/domain';
import type { ZodType, ZodTypeDef } from 'zod';

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; code: ApiErrorCode | 'unreachable' };

function apiUrl(path: string): string {
  const base = process.env.DH_API_URL;
  if (!base) throw new Error('DH_API_URL is not configured');
  return new URL(path, base).toString();
}

async function apiGet<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    const cookie = (await cookies()).toString();
    res = await fetch(apiUrl(path), {
      headers: {
        accept: 'application/json',
        'x-request-id': randomUUID(),
        ...(cookie ? { cookie } : {}),
      },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, code: 'unreachable' };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, status: 502, code: 'internal' };
  }
  const error = ApiErrorBody.safeParse(json);
  return {
    ok: false,
    status: res.status,
    code: error.success ? error.data.error.code : 'internal',
  };
}

export const fetchMe = (): Promise<ApiResult<Me>> => apiGet('/api/me', MeResponse);
export const fetchNavigation = (): Promise<ApiResult<Navigation>> =>
  apiGet('/api/me/navigation', NavigationResponse);
