/**
 * The MFA setup code is typed, never read from the URL (security re-review N2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('../../../../lib/session', () => ({
  getLocale: async () => 'en',
  hasPendingSignIn: async () => true,
}));
vi.mock('../../../../lib/auth-mode', () => ({ authMode: () => 'api' }));
vi.mock('../../../../lib/auth-stub', () => ({ verifyMfaCode: vi.fn(), verifyPasskey: vi.fn() }));

const { default: MfaPage } = await import('./page');
const { ApiMfaSetup } = await import('../api-forms');
const { redirect } = await import('next/navigation');

const render = (params: Record<string, string>) =>
  MfaPage({ searchParams: Promise.resolve(params) }) as Promise<{
    type: unknown;
    props: Record<string, unknown>;
  }>;

describe('MFA setup page', () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it('shows the setup step with an empty code field', async () => {
    const page = await render({ setup: '1' });
    expect(page.type).toBe(ApiMfaSetup);
    expect(page.props).toEqual({ locale: 'en' });
  });

  it('strips a code from the URL without using it', async () => {
    await expect(render({ setup: '1', code: 'v1.leaked-code' })).rejects.toThrow(
      'NEXT_REDIRECT /sign-in/mfa?setup=1',
    );
    await expect(render({ code: 'v1.leaked-code' })).rejects.toThrow('NEXT_REDIRECT /sign-in/mfa');
    for (const [url] of vi.mocked(redirect).mock.calls) expect(url).not.toContain('leaked');
  });
});
