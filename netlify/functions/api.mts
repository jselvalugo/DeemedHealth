/**
 * Netlify Function (Functions API v2) serving /api/* on the web app's origin
 * (ADR-0010 section 1). It builds the API once per function instance and forwards each
 * Web Request through the tested fetch adapter. Only files under netlify/ may read
 * Netlify-specific variables; the API itself gets a validated configuration.
 *
 * Non-production only (ADR-0009): loadApiConfig refuses DH_ENV=production. Until the
 * site has DATABASE_URL and DH_DEV_ROOT_KEY, every request answers 503 not_configured.
 */
import { createApiHandler } from '../../apps/api/dist/index.js';

type NetlifyContext = { ip?: string };

let handler: ((request: Request) => Promise<Response>) | undefined;
const clientIps = new WeakMap<Request, string>();

export default async (request: Request, context: NetlifyContext): Promise<Response> => {
  // DH_PUBLIC_ORIGIN defaults to the deploy's own URL (the preview or the dev site).
  handler ??= createApiHandler(
    {
      ...process.env,
      DH_PUBLIC_ORIGIN:
        process.env.DH_PUBLIC_ORIGIN ?? process.env.DEPLOY_PRIME_URL ?? process.env.URL,
    },
    { clientAddress: (req) => clientIps.get(req) },
  );
  if (context?.ip) clientIps.set(request, context.ip);
  return handler(request);
};

export const config = { path: '/api/*' };
