/**
 * Long-running entry point: local development and the production container (ADR-0010
 * section 1). Configuration errors stop the process and name variables only.
 */
import { ConfigError, loadApiConfig } from './config.js';
import { createApi } from './create.js';

try {
  const config = loadApiConfig(process.env);
  const app = createApi(config);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'API failed to start');
  process.exitCode = 1;
}
