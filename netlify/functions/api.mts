/**
 * Netlify Function (Functions API v2) serving /api/* on the web app's origin
 * (ADR-0010 section 1). It builds the API once per function instance and forwards each
 * Web Request through the tested fetch adapter. Only files under netlify/ may read
 * Netlify-specific variables; the API itself gets a validated configuration.
 *
 * Non-production only (ADR-0009): loadApiConfig refuses DH_ENV=production.
 */
import { createApi, createFetchHandler, loadApiConfig } from '../../apps/api/dist/index.js';

type NetlifyContext = { ip?: string };

let handler: ((request: Request) => Promise<Response>) | undefined;
const clientIps = new WeakMap<Request, string>();

function init(): (request: Request) => Promise<Response> {
  // DH_PUBLIC_ORIGIN defaults to the deploy's own URL (the preview or the dev site).
  const env = {
    ...process.env,
    DH_PUBLIC_ORIGIN:
      process.env.DH_PUBLIC_ORIGIN ?? process.env.DEPLOY_PRIME_URL ?? process.env.URL,
  };
  const config = loadApiConfig(env);
  // One pooled connection per instance (ADR-0010 section 2).
  const app = createApi(config, { poolSize: 1 });
  return createFetchHandler(app, { clientAddress: (request) => clientIps.get(request) });
}

export default async (request: Request, context: NetlifyContext): Promise<Response> => {
  handler ??= init();
  if (context.ip) clientIps.set(request, context.ip);
  return handler(request);
};

export const config = { path: '/api/*' };
