import { API_ERROR_CODES, apiErrorMessageKey } from '@deemed/domain';
import { isMessageKey } from '@deemed/i18n';
import { MODULES } from '@deemed/ui';
import { describe, expect, it, vi } from 'vitest';
import { apiPost } from './api-browser';
import { authMode } from './auth-mode';
import { modulesFromNavigation } from './navigation';

describe('authMode', () => {
  it('uses the demo stub in any non-production environment without a database', () => {
    for (const env of ['local', 'preview', 'development', 'staging']) {
      expect(authMode({ DH_ENV: env }), env).toBe('stub');
      expect(authMode({ DH_ENV: env, DATABASE_URL: '' }), env).toBe('stub');
    }
  });

  it('uses the real API whenever DATABASE_URL is set, and always in production', () => {
    for (const env of ['local', 'preview', 'development', 'staging', 'production']) {
      expect(authMode({ DH_ENV: env, DATABASE_URL: 'postgres://app_user@db/dh' }), env).toBe('api');
    }
    expect(authMode({ DH_ENV: 'production' })).toBe('api');
    // A missing or unknown DH_ENV never gets the demo.
    expect(authMode({})).toBe('api');
    expect(authMode({ DH_ENV: 'prod' })).toBe('api');
  });
});

describe('modulesFromNavigation', () => {
  it('keeps registry order, names, and icons, and only the pages the API allows', () => {
    const modules = modulesFromNavigation({
      modules: [
        { id: 'tasks', pages: [{ id: 'mine', route: '/tasks' }] },
        { id: 'self-service', pages: [{ id: 'profile', route: '/me' }] },
      ],
    });
    expect(modules.map((m) => m.id)).toEqual(['tasks', 'self-service']);
    expect(modules[0]?.pages.map((p) => p.route)).toEqual(['/tasks']);
    expect(modules[0]?.icon).toBe(MODULES.find((m) => m.id === 'tasks')?.icon);
    expect(modulesFromNavigation({ modules: [] })).toEqual([]);
  });
});

describe('API errors in the UI', () => {
  it('have an EN/ES message for every stable error code', () => {
    for (const code of API_ERROR_CODES)
      expect(isMessageKey(apiErrorMessageKey(code)), code).toBe(true);
  });

  it('apiPost sends JSON with the CSRF token and parses the error model', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'forbidden', messageKey: 'apiError.forbidden', correlationId: 'x' },
        }),
        { status: 403 },
      ),
    );
    const res = await apiPost('/api/x', { a: 1 }, 'tok', fetchImpl);
    expect(res).toEqual({ ok: false, status: 403, code: 'forbidden' });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    expect(init.credentials).toBe('same-origin');
    const down = await apiPost(
      '/api/x',
      {},
      undefined,
      vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    );
    expect(down).toEqual({ ok: false, status: 0, code: 'network' });
  });
});
