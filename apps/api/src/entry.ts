/**
 * Serverless entry for hosts that speak Web Request/Response (the Netlify function).
 * Validates configuration once; when it is incomplete (e.g. no DATABASE_URL or
 * DH_DEV_ROOT_KEY yet on the development site), every request gets a clear
 * 503 `not_configured` in the stable error model instead of a crashed function.
 * Only variable NAMES are logged.
 */
import { randomUUID } from 'node:crypto';
import type { Clock } from '@deemed/auth';
import { createFetchHandler, type FetchHandlerOptions } from './adapters/fetch.js';
import { ConfigError, loadApiConfig } from './config.js';
import { createApi } from './create.js';
import { errorBody } from './errors.js';

export type RequestHandler = (request: Request) => Promise<Response>;

function notConfigured(): RequestHandler {
  return async () => {
    const id = randomUUID();
    return new Response(JSON.stringify(errorBody('not_configured', id)), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-request-id': id,
      },
    });
  };
}

export function createApiHandler(
  env: Record<string, string | undefined>,
  options: FetchHandlerOptions & { clock?: Clock; poolSize?: number } = {},
): RequestHandler {
  let config;
  try {
    config = loadApiConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[api] not configured: ${error.names.join(', ') || error.message}`);
    return notConfigured();
  }
  const app = createApi(config, {
    poolSize: options.poolSize ?? 1,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  return createFetchHandler(
    app,
    options.clientAddress ? { clientAddress: options.clientAddress } : {},
  );
}
