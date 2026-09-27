import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiHandler } from './entry.js';

const configured = {
  DH_ENV: 'development',
  // Never connected to in these tests: /api/health does not touch the database.
  DATABASE_URL: 'postgres://app_user@127.0.0.1:1/dh',
  DH_PUBLIC_ORIGIN: 'https://deemed-health-dev.netlify.app',
  DH_DEV_ROOT_KEY: randomBytes(32).toString('base64'),
};

afterEach(() => vi.restoreAllMocks());

describe('serverless entry (Netlify function)', () => {
  it.each([
    ['DATABASE_URL', { ...configured, DATABASE_URL: undefined }],
    ['DH_DEV_ROOT_KEY', { ...configured, DH_DEV_ROOT_KEY: undefined }],
    ['DH_ENV', { ...configured, DH_ENV: 'production' }],
  ])('answers 503 not_configured when %s is missing or refused', async (name, env) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = createApiHandler(env);
    for (const path of ['/api/health', '/api/me', '/api/auth/login']) {
      const res = await handle(new Request(`https://deemed-health-dev.netlify.app${path}`));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toEqual({
        error: {
          code: 'not_configured',
          messageKey: 'apiError.not_configured',
          correlationId: res.headers.get('x-request-id'),
        },
      });
    }
    // Names only, never values.
    expect(log.mock.calls.flat().join(' ')).toContain(name === 'DH_ENV' ? 'KMS' : name);
    expect(log.mock.calls.flat().join(' ')).not.toContain(configured.DH_DEV_ROOT_KEY);
  });

  it('serves the real API when configured', async () => {
    const handle = createApiHandler(configured, { clientAddress: () => '192.0.2.9' });
    const res = await handle(new Request('https://deemed-health-dev.netlify.app/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'api', environment: 'development' });
    const anon = await handle(new Request('https://deemed-health-dev.netlify.app/api/me'));
    expect(anon.status).toBe(401);
  });
});
