/**
 * Builds the API from validated configuration: one pooled database (runtime role only,
 * ADR-0011), the auth service, and the Fastify app. Shared by server.ts and the Netlify
 * function so both run exactly the same composition.
 */
import { AuthService, systemClock, type Clock } from '@deemed/auth';
import { createDatabase } from '@deemed/db';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app.js';
import type { ApiConfig } from './config.js';

export function createApi(
  config: ApiConfig,
  options: { clock?: Clock; poolSize?: number; logger?: FastifyServerOptions['logger'] } = {},
): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const database = createDatabase({
    connectionString: config.databaseUrl,
    max: options.poolSize ?? 5,
    applicationName: 'deemed-api',
  });
  const auth = new AuthService({
    db: database,
    clock,
    secretKey: { root: config.secretRootKey },
    webauthn: config.webauthn,
  });
  const app = buildApp({
    database,
    auth,
    clock,
    dhEnv: config.dhEnv,
    allowedOrigins: config.allowedOrigins,
    secureCookies: config.secureCookies,
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    logger: options.logger ?? {
      level: 'info',
      // Never log cookies, tokens, or bodies.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
    },
  });
  app.addHook('onClose', () => database.close());
  return app;
}
