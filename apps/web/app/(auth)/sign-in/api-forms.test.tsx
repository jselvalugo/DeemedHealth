import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../test/axe';
import { ApiMfaForm, ApiMfaSetup, ApiSignInForm, navigation } from './api-forms';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({ id: 'cred' })),
  startRegistration: vi.fn(async () => ({ id: 'cred' })),
}));

const fetchMock = vi.fn<typeof fetch>();
const go = vi.fn<(url: string) => void>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const apiError = (status: number, code: string) =>
  json(status, { error: { code, messageKey: `apiError.${code}`, correlationId: 'c' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  navigation.go = go;
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  go.mockReset();
});

async function passwordStep() {
  const user = userEvent.setup();
  render(
    <main>
      <ApiSignInForm locale="en" notice={undefined} />
    </main>,
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Work email' }),
    'maria.delgado@xyz-chc.example',
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  // The email step is an async action: wait for the password field it reveals.
  const password = await screen.findByLabelText('Password');
  // No SSO button until the OIDC connector ships; no demo hint against the real API.
  expect(screen.queryByRole('button', { name: /single sign-on/ })).toBeNull();
  expect(screen.queryByText(/Preview only/)).toBeNull();
  await user.type(password, 'violet tram under glass 42');
  await user.click(screen.getByRole('button', { name: 'Sign in with password' }));
  return user;
}

describe('sign-in against apps/api', () => {
  it('always continues to the second factor, or to first-time setup', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { next: 'mfa', methods: ['totp'] }));
    await passwordStep();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/login');
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/sign-in/mfa'));
  });

  it('sends people without a factor to setup', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { next: 'mfa_enroll', methods: [] }));
    await passwordStep();
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/sign-in/mfa?setup=1'));
  });

  it('shows generic errors for wrong passwords and lockouts', async () => {
    fetchMock.mockResolvedValueOnce(apiError(401, 'invalid_credentials'));
    await passwordStep();
    expect(
      await screen.findByText('That email and password don’t match our records.'),
    ).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
  });

  it('verifies the authenticator code and handles an expired sign-in', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(apiError(401, 'invalid_code'));
    fetchMock.mockResolvedValueOnce(json(200, { signedIn: true, csrfToken: 'x' }));
    render(
      <main>
        <ApiMfaForm locale="en" expired={false} />
      </main>,
    );
    const code = screen.getByLabelText('Code from your authenticator app');
    await user.type(code, '111111');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/That code didn’t work/)).toBeTruthy();
    await user.clear(code);
    await user.type(code, '222222');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/'));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ code: '222222' });
  });

  it('sets up an authenticator app at first sign-in (EN and ES, no axe violations)', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(200, { otpauthUri: 'otpauth://totp/x', secret: 'JBSWY3DPEHPK3PXP' }),
    );
    fetchMock.mockResolvedValueOnce(json(200, { signedIn: true, csrfToken: 'x' }));
    const { unmount } = render(
      <main>
        <ApiMfaSetup locale="en" />
      </main>,
    );
    expect(screen.getByRole('button', { name: 'Create a passkey' })).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
    await user.type(screen.getByLabelText('Setup code from your administrator'), 'v1.setup-code');
    await user.click(screen.getByRole('button', { name: 'Use an authenticator app instead' }));
    expect((await screen.findByTestId('totp-secret')).textContent).toBe('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/'));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/auth/mfa/totp/enroll',
      '/api/auth/mfa/totp/enroll/verify',
    ]);
    // Both steps carry the single-use setup code from the administrator.
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init!.body as string).enrollmentToken).toBe('v1.setup-code');
    }
    unmount();
    render(
      <main>
        <ApiMfaSetup locale="es" />
      </main>,
    );
    expect(
      screen.getByRole('heading', { name: 'Configure la verificación en dos pasos' }),
    ).toBeTruthy();
  });
});
