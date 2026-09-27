/**
 * Web `Request` -> Fastify `inject()` -> Web `Response` (ADR-0010 section 1). Used by
 * the Netlify function; the same app runs unchanged under `server.ts` on ECS.
 */
import type { FastifyInstance } from 'fastify';

export interface FetchHandlerOptions {
  /** Client address as the host reports it (Netlify: context.ip). */
  clientAddress?: (request: Request) => string | undefined;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
]);

export function createFetchHandler(app: FastifyInstance, options: FetchHandlerOptions = {}) {
  let ready: PromiseLike<unknown> | undefined;
  return async function handle(request: Request): Promise<Response> {
    ready ??= app.ready();
    await ready;
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key)) headers[key] = value;
    });
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const payload = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;
    const remoteAddress = options.clientAddress?.(request);
    const res = await app.inject({
      method: request.method as 'GET',
      url: `${url.pathname}${url.search}`,
      headers,
      ...(payload && payload.length > 0 ? { payload } : {}),
      ...(remoteAddress ? { remoteAddress } : {}),
    });
    const out = new Headers();
    for (const [key, value] of Object.entries(res.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key) || key === 'content-length') continue;
      if (Array.isArray(value)) for (const v of value) out.append(key, String(v));
      else out.set(key, String(value));
    }
    const body =
      res.statusCode === 204 || res.statusCode === 304 ? null : new Uint8Array(res.rawPayload);
    return new Response(body, { status: res.statusCode, headers: out });
  };
}
