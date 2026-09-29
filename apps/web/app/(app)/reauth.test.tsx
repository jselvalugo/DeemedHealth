import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test/axe';
import { ApiProvider, useApi } from './reauth';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({ id: 'cred' })),
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const reauthRequired = () =>
  json(401, {
    error: { code: 'reauth_required', messageKey: 'apiError.reauth_required', correlationId: 'c' },
  });

function Grant() {
  const api = useApi();
  const [result, setResult] = useState('');
  return (
    <main>
      <button
        type="button"
        onClick={async () => {
          const res = await api.post('/api/admin/role-assignments', { roleId: 'finance' });
          setResult(res.ok ? 'granted' : `failed: ${res.code}`);
        }}
      >
        Grant
      </button>
      <p>{result}</p>
    </main>
  );
}

describe('re-authentication dialog (ADR-0006 rule 5)', () => {
  it('opens on 401 reauth_required, steps up with a code, and retries once', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reauthRequired())
      .mockResolvedValueOnce(json(200, { reauthenticatedAt: 'now', validForSeconds: 300 }))
      .mockResolvedValueOnce(json(200, { id: 'ra-1' }));
    render(
      <ApiProvider locale="en" csrfToken="csrf-1" fetchImpl={fetchImpl}>
        <Grant />
      </ApiProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Grant' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(dialog).toBeTruthy();
    expect(await axeViolations()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText('Enter the 6-digit code.')).toBeTruthy();

    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('granted');
    expect(screen.queryByRole('dialog')).toBeNull();

    const calls = fetchImpl.mock.calls.map(([url, init]) => [
      url,
      (init?.headers as Record<string, string>)['x-csrf-token'],
    ]);
    expect(calls).toEqual([
      ['/api/admin/role-assignments', 'csrf-1'],
      ['/api/auth/reauth/totp', 'csrf-1'],
      ['/api/admin/role-assignments', 'csrf-1'],
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string)).toEqual({ code: '123456' });
  });

  it('returns the original error when the person cancels', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(reauthRequired());
    render(
      <ApiProvider locale="es" csrfToken="csrf-1" fetchImpl={fetchImpl}>
        <Grant />
      </ApiProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Grant' }));
    await screen.findByRole('dialog', { name: 'Confirme que es usted' });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await screen.findByText('failed: reauth_required');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one dialog between concurrent requests and retries them all (finding L6)', async () => {
    const user = userEvent.setup();
    const byUrl = (url: string) =>
      url === '/api/auth/reauth/totp'
        ? json(200, { reauthenticatedAt: 'now', validForSeconds: 300 })
        : null;
    let first = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const reauth = byUrl(url);
      if (reauth) return reauth;
      // Each of the two requests is refused once, then succeeds.
      first++;
      return first <= 2 ? reauthRequired() : json(200, { id: url });
    });
    function Two() {
      const api = useApi();
      const [results, setResults] = useState<string[]>([]);
      return (
        <main>
          <button
            type="button"
            onClick={async () => {
              const all = await Promise.all([api.post('/api/a'), api.post('/api/b')]);
              setResults(all.map((r) => (r.ok ? 'ok' : r.code)));
            }}
          >
            Both
          </button>
          <p>{results.join(',')}</p>
        </main>
      );
    }
    render(
      <ApiProvider locale="en" csrfToken="csrf-1" fetchImpl={fetchImpl}>
        <Two />
      </ApiProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Both' }));
    await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('ok,ok');
    const reauthCalls = fetchImpl.mock.calls.filter(([u]) => String(u) === '/api/auth/reauth/totp');
    expect(reauthCalls).toHaveLength(1);
  });

  it('shows a wrong code without closing', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reauthRequired())
      .mockResolvedValueOnce(
        json(401, {
          error: { code: 'invalid_code', messageKey: 'apiError.invalid_code', correlationId: 'c' },
        }),
      );
    render(
      <ApiProvider locale="en" csrfToken="csrf-1" fetchImpl={fetchImpl}>
        <Grant />
      </ApiProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Grant' }));
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText(/That code didn’t work/)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
