// @deemed/api: the Fastify API (ADR-0001, ADR-0010 section 1).
export { buildApp, type BuildAppOptions } from './app.js';
export { createApi } from './create.js';
export { ConfigError, loadApiConfig, type ApiConfig } from './config.js';
export { createFetchHandler, type FetchHandlerOptions } from './adapters/fetch.js';
export { ROUTES, ROUTE_IDS, requiredCases, type RouteId, type RouteSpec } from './manifest.js';
export type { AppServices, RequestContext } from './context.js';
