/**
 * Builds the API from validated configuration: one pooled database (runtime role only,
 * ADR-0011), the auth service, and the Fastify app. Shared by server.ts and the Netlify
 * function so both run exactly the same composition.
 */
import { AuthService, systemClock, type Clock } from '@deemed/auth';
import { CatalogChannelMismatchError, assertCatalogChannel, createDatabase } from '@deemed/db';
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
  let verified: Promise<void> | undefined;
  const ensureCatalogChannel = (): Promise<void> => {
    verified ??= assertCatalogChannel(database, config.dhEnv).then(
      () => undefined,
      (error: unknown) => {
        // A mismatch is final; a connection error is retried on the next request.
        if (!(error instanceof CatalogChannelMismatchError)) verified = undefined;
        throw error;
      },
    );
    return verified;
  };
  const app = buildApp({
    ensureCatalogChannel,
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
  // S4: refuse to start when DH_ENV and the database's catalog channel disagree. A database
  // that is unreachable at startup is checked again before the first signed-in request
  // (ensureCatalogChannel in buildApp), so the guard never silently lapses.
  app.addHook('onReady', async () => {
    try {
      await ensureCatalogChannel();
    } catch (error) {
      if (error instanceof CatalogChannelMismatchError) throw error;
      console.error('[api] catalog channel not verified at startup: database unreachable');
    }
  });
  app.addHook('onClose', () => database.close());
  return app;
}
