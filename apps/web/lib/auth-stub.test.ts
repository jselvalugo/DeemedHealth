import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal stand-ins for the Next.js request APIs used by the server actions.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const actions = await import('./auth-stub');
const demo = await import('./auth-demo');
const session = await import('./session');
const { IDLE } = await import('./auth-types');

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
  throw new Error('expected a redirect');
}

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllEnvs());

describe('auth stub in production', () => {
  beforeEach(() => vi.stubEnv('DH_ENV', 'production'));

  it('returns "not implemented" from every sign-in step', async () => {
    const valid = form({
      email: 'demo@xyz-chc.test',
      password: 'long-enough-password',
      code: '000000',
    });
    expect(await actions.startSignIn(IDLE, valid)).toEqual({ status: 'not_implemented' });
    expect(await actions.signInWithPassword(IDLE, valid)).toEqual({ status: 'not_implemented' });
    expect(await actions.signInWithSso(IDLE, valid)).toEqual({ status: 'not_implemented' });
    expect(await actions.verifyMfaCode(IDLE, valid)).toEqual({ status: 'not_implemented' });
    expect(await actions.verifyPasskey()).toEqual({ status: 'not_implemented' });
    expect(
      await actions.redeemRecoveryCode(
        IDLE,
        form({ email: 'demo@xyz-chc.test', code: 'DEMO-CODE' }),
      ),
    ).toEqual({ status: 'not_implemented' });
    expect(jar.size).toBe(0);
  });

  it('refuses to touch demo users at all', () => {
    expect(() => demo.assertDemoAllowed()).toThrow(demo.DemoInProductionError);
    expect(() => demo.findDemoUserByEmail('demo@xyz-chc.test')).toThrow(/production/);
    expect(() => demo.checkDemoTotp('000000')).toThrow(/production/);
  });

  it('never reports a session, even with a demo cookie present', async () => {
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await session.getCurrentUser()).toBeNull();
  });
});

describe('auth stub outside production (synthetic demo)', () => {
  beforeEach(() => vi.stubEnv('DH_ENV', 'local'));

  it('validates the email without revealing whether an account exists', async () => {
    expect(await actions.startSignIn(IDLE, form({ email: '' }))).toMatchObject({
      code: 'email_required',
      field: 'email',
    });
    expect(await actions.startSignIn(IDLE, form({ email: 'not-an-email' }))).toMatchObject({
      code: 'email_invalid',
    });
    expect(await actions.startSignIn(IDLE, form({ email: 'nobody@example.test' }))).toEqual({
      status: 'method',
      email: 'nobody@example.test',
      sso: true,
    });
  });

  it('signs the demo user in with a password and code 000000', async () => {
    const email = 'demo@xyz-chc.test';
    expect(await actions.signInWithPassword(IDLE, form({ email, password: 'short' }))).toEqual({
      status: 'error',
      code: 'invalid_credentials',
    });
    expect(
      await redirectOf(
        actions.signInWithPassword(IDLE, form({ email, password: 'correct-horse-battery' })),
      ),
    ).toBe('/sign-in/mfa');
    expect(await actions.verifyMfaCode(IDLE, form({ code: '12345' }))).toMatchObject({
      code: 'code_format',
    });
    expect(await actions.verifyMfaCode(IDLE, form({ code: '123456' }))).toMatchObject({
      code: 'code_invalid',
    });
    expect(await redirectOf(actions.verifyMfaCode(IDLE, form({ code: '000000' })))).toBe('/');
    const user = await session.getCurrentUser();
    expect(user?.email).toBe(email);
    expect(user?.tenant.name).toBe('XYZ Community Health Center');
    expect(user?.permissions.has('admin:read')).toBe(true);
  });

  it('reports locked accounts and expired second steps', async () => {
    expect(
      await actions.signInWithPassword(
        IDLE,
        form({ email: 'locked@xyz-chc.test', password: 'correct-horse-battery' }),
      ),
    ).toEqual({ status: 'error', code: 'locked' });
    expect(await actions.verifyMfaCode(IDLE, form({ code: '000000' }))).toEqual({
      status: 'error',
      code: 'expired',
    });
  });

  it('signs out', async () => {
    jar.set('dh_demo_session', 'demo-compliance');
    expect(await redirectOf(actions.signOut())).toBe('/sign-in?reason=signed-out');
    expect(jar.size).toBe(0);
  });
});
