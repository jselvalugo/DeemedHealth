/**
 * Identity integration tests (G1-4, ADR-0006): sign-in with mandatory MFA (TOTP and
 * passkeys), sessions with idle and absolute timeouts on a fake clock, rotation,
 * step-up, throttling and lockout, and the error model. Every auth endpoint's required
 * cases are here (defineRouteTests).
 */
import { accountKey } from '@deemed/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES } from '../src/manifest.js';
import { ctx, describeDb } from '../../../packages/db/test/helpers.js';
import { SoftwareAuthenticator } from './authenticator.js';
import {
  Client,
  ORIGIN,
  RP_ID,
  TEST_PASSWORD,
  ageThrottle,
  auditFor,
  createUser,
  nextCode,
  signIn,
  startApi,
  type TestApi,
  type TestUser,
  retarget,
} from './harness.js';
import { defineRouteTests } from './route-tests.js';

let api: TestApi;

beforeAll(async () => {
  if (!ctx.available) return;
  api = await startApi();
});

afterAll(async () => {
  await api?.close();
});

const staff = () => createUser(api, 'xyz', [{ roleId: 'staff_provider' }]);

async function passwordStep(user: TestUser, client = new Client(api)) {
  const res = await client.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD });
  expect(res.statusCode).toBe(200);
  return { client, res };
}

/** Enrolls a passkey as the user's first factor; returns the signed-in client. */
async function enrollPasskey(user: TestUser): Promise<Client> {
  const { client } = await passwordStep(user);
  const enrollmentToken = user.enrollmentToken;
  const options = (
    await client.post('/api/auth/mfa/passkey/enroll/options', { enrollmentToken })
  ).json();
  user.passkey = new SoftwareAuthenticator(RP_ID, ORIGIN);
  const res = await client.post('/api/auth/mfa/passkey/enroll/verify', {
    enrollmentToken,
    response: user.passkey.register(options),
  });
  expect(res.statusCode).toBe(200);
  client.csrf = res.json().csrfToken;
  return client;
}

// ---------------------------------------------------------------------------
// Endpoint cases
// ---------------------------------------------------------------------------

defineRouteTests('health', {
  allowed: async () => {
    const res = await new Client(api).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'api', environment: 'local' });
    expect(res.headers['cache-control']).toBe('no-store');
  },
});

defineRouteTests('auth.login', {
  allowed: async () => {
    const user = await staff();
    const { client, res } = await passwordStep(user);
    // The password alone never yields a session: a second factor is always next.
    expect(res.json()).toEqual({ next: 'mfa_enroll', methods: [] });
    expect(client.sessionToken).toBeUndefined();
    expect(client.jar.has('__Host-dh_signin')).toBe(true);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^__Host-dh_signin=v1\..*HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
        ),
      ]),
    );
    expect((await client.get('/api/me')).statusCode).toBe(401);
  },
  wrongPasswordIsGenericAndAudited: async () => {
    const user = await staff();
    const client = new Client(api);
    const wrong = await client.post('/api/auth/login', {
      email: user.email,
      password: 'not the password at all',
    });
    const unknown = await client.post('/api/auth/login', {
      email: 'nobody@xyz-chc.example',
      password: 'not the password at all',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('invalid_credentials');
    expect(unknown.json().error.code).toBe('invalid_credentials');
    const [event] = await auditFor(api, wrong);
    expect(event).toMatchObject({
      action: 'session.login_failed',
      outcome: 'failure',
      actor_type: 'system',
      target_id: user.userAccountId,
      ip_address: client.ip,
      user_agent: 'vitest-browser',
    });
    // No tenant, no chain: an unknown email leaves no audit row.
    expect(await auditFor(api, unknown)).toEqual([]);
  },
});

defineRouteTests('auth.totp.enroll', {
  allowed: async () => {
    const user = await staff();
    const { client } = await passwordStep(user);
    const res = await client.post('/api/auth/mfa/totp/enroll', {
      enrollmentToken: user.enrollmentToken,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().otpauthUri).toMatch(/^otpauth:\/\/totp\/Deemed%20Health:/);
  },
  noPendingSignIn: async () => {
    const res = await new Client(api).post('/api/auth/mfa/totp/enroll', {
      enrollmentToken: 'v1.none',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('session_expired');
  },
  refusedOnceAFactorExists: async () => {
    // A password alone can never add a factor to an account that already has MFA.
    const user = await staff();
    await signIn(api, user);
    const { client } = await passwordStep(user);
    const enrollmentToken = user.enrollmentToken;
    expect((await client.post('/api/auth/mfa/totp/enroll', { enrollmentToken })).statusCode).toBe(
      403,
    );
    expect(
      (await client.post('/api/auth/mfa/passkey/enroll/options', { enrollmentToken })).statusCode,
    ).toBe(403);
  },
  refusedWithoutAValidEnrollmentToken: async () => {
    // A password alone cannot enroll a first factor either (security review finding 1).
    const user = await staff();
    const other = await staff();
    const { client } = await passwordStep(user);
    for (const enrollmentToken of ['', 'v1.garbage', other.enrollmentToken]) {
      const res = await client.post('/api/auth/mfa/totp/enroll', { enrollmentToken });
      expect([400, 403]).toContain(res.statusCode);
      if (res.statusCode === 403) expect(res.json().error.code).toBe('enrollment_token_invalid');
    }
    const passkey = await client.post('/api/auth/mfa/passkey/enroll/options', {
      enrollmentToken: other.enrollmentToken,
    });
    expect(passkey.json().error.code).toBe('enrollment_token_invalid');
    // Expired after 72 hours.
    api.clock.advance({ hours: 73 });
    const late = await passwordStep(user);
    const expired = await late.client.post('/api/auth/mfa/totp/enroll', {
      enrollmentToken: user.enrollmentToken,
    });
    expect(expired.json().error.code).toBe('enrollment_token_invalid');
  },
  tokenIsSingleUse: async () => {
    const user = await staff();
    const first = await signIn(api, user);
    expect(first.sessionToken).toBeDefined();
    // Even after an MFA reset by SQL (no new token), the old token stays spent.
    await api.admin.query(
      `UPDATE auth.auth_factor SET revoked_at = now(), revoke_reason = 'mfa_reset'
       WHERE user_account_id = $1 AND revoked_at IS NULL`,
      [user.userAccountId],
    );
    const { client } = await passwordStep(user);
    const again = await client.post('/api/auth/mfa/totp/enroll', {
      enrollmentToken: user.enrollmentToken,
    });
    expect(again.json().error.code).toBe('enrollment_token_invalid');
  },
});

defineRouteTests('auth.totp.enroll.verify', {
  allowed: async () => {
    const user = await staff();
    const client = await signIn(api, user);
    expect(client.sessionToken).toMatch(/^v1\./);
    const me = await client.get('/api/me');
    expect(me.json().session.mfaMethod).toBe('totp');
  },
  noPendingSignIn: async () => {
    expect(
      (
        await new Client(api).post('/api/auth/mfa/totp/enroll/verify', {
          code: '123456',
          enrollmentToken: 'v1.none',
        })
      ).statusCode,
    ).toBe(401);
  },
});

defineRouteTests('auth.totp.verify', {
  allowed: async () => {
    const user = await staff();
    await signIn(api, user); // enrolls
    const { client } = await passwordStep(user);
    const res = await client.post('/api/auth/mfa/totp/verify', { code: nextCode(api, user) });
    expect(res.statusCode).toBe(200);
    const actions = (await auditFor(api, res)).map((e) => e.action);
    expect(actions).toEqual(['mfa.challenge', 'session.login']);
    expect(client.jar.has('__Host-dh_signin')).toBe(false);
  },
  noPendingSignIn: async () => {
    expect(
      (await new Client(api).post('/api/auth/mfa/totp/verify', { code: '123456' })).statusCode,
    ).toBe(401);
  },
  wrongCodesEndThePendingSignIn: async () => {
    const user = await staff();
    await signIn(api, user);
    const { client } = await passwordStep(user);
    for (let i = 0; i < 5; i++) {
      const res = await client.post('/api/auth/mfa/totp/verify', { code: '000000' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('invalid_code');
    }
    // Even the right code is refused now; the user has to start again.
    const after = await client.post('/api/auth/mfa/totp/verify', { code: nextCode(api, user) });
    expect(after.json().error.code).toBe('session_expired');
    expect(client.sessionToken).toBeUndefined();
  },
  replayedCodeIsRefused: async () => {
    const user = await staff();
    await signIn(api, user);
    const code = nextCode(api, user);
    const first = await passwordStep(user);
    expect((await first.client.post('/api/auth/mfa/totp/verify', { code })).statusCode).toBe(200);
    const second = await passwordStep(user);
    expect((await second.client.post('/api/auth/mfa/totp/verify', { code })).statusCode).toBe(401);
  },
  pendingSignInExpiresAfterTenMinutes: async () => {
    const user = await staff();
    await signIn(api, user);
    const { client } = await passwordStep(user);
    api.clock.advance({ minutes: 10, seconds: 1 });
    const res = await client.post('/api/auth/mfa/totp/verify', { code: nextCode(api, user) });
    expect(res.json().error.code).toBe('session_expired');
  },
});

defineRouteTests('auth.passkey.enroll.options', {
  allowed: async () => {
    const user = await staff();
    const { client } = await passwordStep(user);
    const res = await client.post('/api/auth/mfa/passkey/enroll/options', {
      enrollmentToken: user.enrollmentToken,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      rp: { id: RP_ID },
      authenticatorSelection: { userVerification: 'required' },
    });
  },
  noPendingSignIn: async () => {
    expect(
      (
        await new Client(api).post('/api/auth/mfa/passkey/enroll/options', {
          enrollmentToken: 'v1.none',
        })
      ).statusCode,
    ).toBe(401);
  },
});

defineRouteTests('auth.passkey.enroll.verify', {
  allowed: async () => {
    const user = await staff();
    const client = await enrollPasskey(user);
    expect((await client.get('/api/me')).json().session.mfaMethod).toBe('passkey');
  },
  noPendingSignIn: async () => {
    expect(
      (
        await new Client(api).post('/api/auth/mfa/passkey/enroll/verify', {
          response: {},
          enrollmentToken: 'v1.none',
        })
      ).statusCode,
    ).toBe(401);
  },
});

defineRouteTests('auth.passkey.options', {
  allowed: async () => {
    const user = await staff();
    await enrollPasskey(user);
    const { client, res } = await passwordStep(user);
    expect(res.json()).toEqual({ next: 'mfa', methods: ['passkey'] });
    const options = (await client.post('/api/auth/mfa/passkey/options')).json();
    expect(options.allowCredentials).toHaveLength(1);
    expect(options.userVerification).toBe('required');
  },
  noPendingSignIn: async () => {
    expect((await new Client(api).post('/api/auth/mfa/passkey/options')).statusCode).toBe(401);
  },
});

defineRouteTests('auth.passkey.verify', {
  allowed: async () => {
    const user = await staff();
    await enrollPasskey(user);
    const { client } = await passwordStep(user);
    const options = (await client.post('/api/auth/mfa/passkey/options')).json();
    const res = await client.post('/api/auth/mfa/passkey/verify', {
      response: user.passkey!.authenticate(options),
    });
    expect(res.statusCode).toBe(200);
    expect((await auditFor(api, res)).map((e) => e.action)).toEqual([
      'mfa.challenge',
      'session.login',
    ]);
  },
  noPendingSignIn: async () => {
    expect(
      (await new Client(api).post('/api/auth/mfa/passkey/verify', { response: {} })).statusCode,
    ).toBe(401);
  },
  userVerificationRequired: async () => {
    const user = await staff();
    await enrollPasskey(user);
    const { client } = await passwordStep(user);
    const options = (await client.post('/api/auth/mfa/passkey/options')).json();
    const res = await client.post('/api/auth/mfa/passkey/verify', {
      response: user.passkey!.authenticate(options, { userVerified: false }),
    });
    expect(res.statusCode).toBe(401);
    expect(client.sessionToken).toBeUndefined();
  },
  challengeIsSingleUse: async () => {
    const user = await staff();
    await enrollPasskey(user);
    const { client } = await passwordStep(user);
    const options = (await client.post('/api/auth/mfa/passkey/options')).json();
    const forged = new SoftwareAuthenticator(RP_ID, ORIGIN).authenticate(options);
    expect(
      (await client.post('/api/auth/mfa/passkey/verify', { response: forged })).statusCode,
    ).toBe(401);
    // The challenge was spent by the failed attempt.
    const replay = await client.post('/api/auth/mfa/passkey/verify', {
      response: user.passkey!.authenticate(options),
    });
    expect(replay.statusCode).toBe(401);
  },
});

defineRouteTests('auth.reauth.totp', {
  allowed: async () => {
    const user = await staff();
    const client = await signIn(api, user);
    api.clock.advance({ minutes: 6 });
    const res = await client.post('/api/auth/reauth/totp', { code: nextCode(api, user) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ validForSeconds: 300 });
    expect((await auditFor(api, res)).map((e) => [e.action, e.outcome])).toEqual([
      ['session.reauth', 'success'],
    ]);
    const wrong = await client.post('/api/auth/reauth/totp', { code: '000000' });
    expect(wrong.statusCode).toBe(401);
    expect((await auditFor(api, wrong)).map((e) => [e.action, e.outcome])).toEqual([
      ['session.reauth', 'failure'],
    ]);
  },
  unauthenticated: async () => {
    expect(
      (await new Client(api).post('/api/auth/reauth/totp', { code: '123456' })).statusCode,
    ).toBe(401);
  },
  otherTenant: async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const gulf = api.tenants.gulf.organizationId;
    const forged = retarget(client.sessionToken as string, user.organizationId, gulf);
    const res = await new Client(api).post(
      '/api/auth/reauth/totp',
      { code: '123456' },
      {
        cookie: `__Host-dh_session=${forged}`,
      },
    );
    expect(res.statusCode).toBe(401);
  },
});

defineRouteTests('auth.reauth.passkey.options', {
  allowed: async () => {
    const user = await staff();
    const client = await enrollPasskey(user);
    const res = await client.post('/api/auth/reauth/passkey/options');
    expect(res.statusCode).toBe(200);
    expect(res.json().allowCredentials).toHaveLength(1);
  },
  unauthenticated: async () => {
    expect((await new Client(api).post('/api/auth/reauth/passkey/options')).statusCode).toBe(401);
  },
  otherTenant: async () => {
    const user = await staff();
    const client = await enrollPasskey(user);
    const forged = retarget(
      client.sessionToken as string,
      user.organizationId,
      api.tenants.gulf.organizationId,
    );
    const res = await new Client(api).post(
      '/api/auth/reauth/passkey/options',
      {},
      { cookie: `__Host-dh_session=${forged}` },
    );
    expect(res.statusCode).toBe(401);
  },
});

defineRouteTests('auth.reauth.passkey.verify', {
  allowed: async () => {
    const user = await staff();
    const client = await enrollPasskey(user);
    api.clock.advance({ minutes: 6 });
    const options = (await client.post('/api/auth/reauth/passkey/options')).json();
    const res = await client.post('/api/auth/reauth/passkey/verify', {
      response: user.passkey!.authenticate(options),
    });
    expect(res.statusCode).toBe(200);
    expect((await auditFor(api, res)).map((e) => e.action)).toEqual(['session.reauth']);
  },
  unauthenticated: async () => {
    expect(
      (await new Client(api).post('/api/auth/reauth/passkey/verify', { response: {} })).statusCode,
    ).toBe(401);
  },
  otherTenant: async () => {
    const user = await staff();
    const client = await enrollPasskey(user);
    const forged = retarget(
      client.sessionToken as string,
      user.organizationId,
      api.tenants.gulf.organizationId,
    );
    const res = await new Client(api).post(
      '/api/auth/reauth/passkey/verify',
      { response: {} },
      {
        cookie: `__Host-dh_session=${forged}`,
      },
    );
    expect(res.statusCode).toBe(401);
  },
});

defineRouteTests('auth.logout', {
  allowed: async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const token = client.sessionToken;
    const res = await client.post('/api/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(client.sessionToken).toBeUndefined();
    expect((await auditFor(api, res)).map((e) => e.action)).toEqual(['session.logout']);
    const reuse = await new Client(api).get('/api/me', { cookie: `__Host-dh_session=${token}` });
    expect(reuse.statusCode).toBe(401);
  },
  unauthenticated: async () => {
    expect((await new Client(api).post('/api/auth/logout')).statusCode).toBe(401);
  },
  otherTenant: async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const forged = retarget(
      client.sessionToken as string,
      user.organizationId,
      api.tenants.gulf.organizationId,
    );
    const res = await new Client(api).post(
      '/api/auth/logout',
      {},
      { cookie: `__Host-dh_session=${forged}` },
    );
    expect(res.statusCode).toBe(401);
    expect((await client.get('/api/me')).statusCode).toBe(200);
  },
});

// ---------------------------------------------------------------------------
// Sessions on a fake clock (ADR-0006 rule 4)
// ---------------------------------------------------------------------------

describeDb('sessions (fake clock)', () => {
  it('expire after 15 minutes idle, are revoked, and the expiry is audited', async () => {
    const user = await staff();
    const client = await signIn(api, user);
    api.clock.advance({ minutes: 14, seconds: 59 });
    expect((await client.get('/api/me')).statusCode).toBe(200); // activity resets the idle timer
    api.clock.advance({ minutes: 15, seconds: 1 });
    const res = await client.get('/api/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('session_expired');
    expect(client.sessionToken).toBeUndefined(); // cookie cleared
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({ action: 'session.expired', metadata: { reason: 'idle' } });
  });

  it('expire 12 hours after sign-in however active the user is', async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const me = (await client.get('/api/me')).json();
    const end = new Date(me.session.expiresAt).getTime();
    while (api.clock.now().getTime() + 14 * 60_000 < end) {
      api.clock.advance({ minutes: 14 });
      expect((await client.get('/api/me')).statusCode).toBe(200);
    }
    api.clock.set(new Date(end));
    const res = await client.get('/api/me');
    expect(res.json().error.code).toBe('session_expired');
    const [event] = await auditFor(api, res);
    expect(event).toMatchObject({ action: 'session.expired', metadata: { reason: 'absolute' } });
  });

  it('rotate on login: signing in again ends the session the browser held', async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const old = client.sessionToken;
    await signIn(api, user, client);
    expect(client.sessionToken).not.toBe(old);
    const stale = await new Client(api).get('/api/me', { cookie: `__Host-dh_session=${old}` });
    expect(stale.statusCode).toBe(401);
  });

  it('set HttpOnly, Secure, SameSite=Lax, host-prefixed cookies that end with the session', async () => {
    const user = await staff();
    const client = new Client(api);
    await client.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD });
    const enrollmentToken = user.enrollmentToken;
    const enroll = await client.post('/api/auth/mfa/totp/enroll', { enrollmentToken });
    user.totpSecret = (await import('@deemed/auth')).secretFromBase32(enroll.json().secret);
    const done = await client.post('/api/auth/mfa/totp/enroll/verify', {
      enrollmentToken,
      code: nextCode(api, user),
    });
    const cookies = ([] as string[]).concat(done.headers['set-cookie'] as string | string[]);
    const session = cookies.find((c) => c.startsWith('__Host-dh_session='));
    expect(session).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/);
  });

  it('leave no code path to a session without a second factor, and none to turn MFA off', async () => {
    const user = await staff();
    const { client } = await passwordStep(user);
    for (const route of Object.values(ROUTES)) {
      if (route.access.kind === 'signin' || route.url.includes(':')) continue;
      await client.request(route.method, route.url, {});
      expect(client.sessionToken, route.url).toBeUndefined();
    }
    const urls = Object.values(ROUTES).map((r) => r.url.toLowerCase());
    expect(
      urls.filter((u) => u.includes('disable') || u.includes('delete') || u.includes('remove')),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Throttling and lockout (ADR-0006 rule 11)
// ---------------------------------------------------------------------------

describeDb('throttling (database clock)', () => {
  it('locks an account after repeated failures, with the same answer for unknown emails', async () => {
    const user = await staff();
    const client = new Client(api);
    const attempt = (email: string, password = 'definitely wrong password') =>
      client.post('/api/auth/login', { email, password });
    for (let i = 0; i < 5; i++) expect((await attempt(user.email)).statusCode).toBe(401);
    const locking = await attempt(user.email);
    expect(locking.statusCode).toBe(401);
    expect((await auditFor(api, locking)).map((e) => e.action)).toEqual([
      'session.login_failed',
      'account.locked',
    ]);
    const locked = await attempt(user.email, TEST_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('too_many_attempts');

    const ghost = 'ghost@xyz-chc.example';
    const other = new Client(api);
    for (let i = 0; i < 6; i++)
      await other.post('/api/auth/login', { email: ghost, password: 'wrong wrong wrong' });
    expect(
      (await other.post('/api/auth/login', { email: ghost, password: 'wrong wrong wrong' }))
        .statusCode,
    ).toBe(429);

    await ageThrottle(api, [accountKey(user.email).hash], 61);
    const fresh = await new Client(api).post('/api/auth/login', {
      email: user.email,
      password: TEST_PASSWORD,
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('throttles an IP prefix across accounts', async () => {
    const client = new Client(api);
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (
        await client.post('/api/auth/login', {
          email: `spray${i}@xyz-chc.example`,
          password: 'wrong wrong wrong',
        })
      ).statusCode;
    }
    expect(last).toBe(401);
    expect(
      (
        await client.post('/api/auth/login', {
          email: 'spray-final@xyz-chc.example',
          password: 'x'.repeat(12),
        })
      ).statusCode,
    ).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Error model, CSRF, origin
// ---------------------------------------------------------------------------

describeDb('error model and request checks', () => {
  it('answers unknown routes and bad bodies with the stable model and the correlation id', async () => {
    const client = new Client(api);
    const missing = await client.get('/api/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: {
        code: 'not_found',
        messageKey: 'apiError.not_found',
        correlationId: missing.headers['x-request-id'],
      },
    });
    const bad = await client.post('/api/auth/login', {
      email: 'not-an-email',
      password: '',
      extra: 1,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');
    expect(bad.json().error.fields).toEqual(expect.arrayContaining(['email', 'password']));
    expect(bad.body).not.toContain('not-an-email');
    const broken = await client.request('POST', '/api/auth/login', undefined, {
      'content-type': 'application/json',
    });
    expect(broken.statusCode).toBeLessThan(500);
    for (const res of [missing, bad, broken]) {
      expect(res.body).not.toMatch(/stack|at .*\.ts:\d+/);
    }
  });

  it('keeps a caller-supplied request id when it is a UUID, and replaces anything else', async () => {
    const id = crypto.randomUUID();
    expect(
      (await new Client(api).get('/api/health', { 'x-request-id': id })).headers['x-request-id'],
    ).toBe(id);
    expect(
      (await new Client(api).get('/api/health', { 'x-request-id': 'drop table' })).headers[
        'x-request-id'
      ],
    ).not.toBe('drop table');
  });

  it('refuses mutations without the CSRF token or from another origin', async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const csrf = client.csrf;
    client.csrf = undefined;
    const noToken = await client.post('/api/auth/logout');
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error.code).toBe('csrf_failed');
    client.csrf = csrf;
    const foreign = await client.post('/api/auth/logout', {}, { origin: 'https://evil.example' });
    expect(foreign.json().error.code).toBe('csrf_failed');
    const crossSite = await client.post('/api/auth/logout', {}, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.json().error.code).toBe('csrf_failed');
    expect((await client.post('/api/auth/logout')).statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Second-factor brute force and races (security review findings 2 and 3)
// ---------------------------------------------------------------------------

/** Wrong second-factor answers that were evaluated (each is audited as a failed challenge). */
async function failedGuesses(user: TestUser): Promise<number> {
  const { rows } = await api.admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit.audit_event
     WHERE target_id = $1 AND outcome = 'failure' AND action IN ('mfa.challenge', 'session.reauth')`,
    [user.userAccountId],
  );
  return rows[0]!.n;
}

describeDb('second factor across pending sign-ins', () => {
  it('counts wrong codes per user, across attempts, and locks every open attempt', async () => {
    const user = await staff();
    await signIn(api, user);
    const a = await passwordStep(user);
    const b = await passwordStep(user);
    for (const { client } of [a, a, a, b, b, b]) {
      await client.post('/api/auth/mfa/totp/verify', { code: '000000' });
    }
    // The sixth wrong code locked the account: the right code no longer helps.
    const res = await a.client.post('/api/auth/mfa/totp/verify', { code: nextCode(api, user) });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('too_many_attempts');
    expect(a.client.sessionToken).toBeUndefined();
  });

  it('evaluates at most five guesses on one pending sign-in, however many arrive at once', async () => {
    const user = await staff();
    await signIn(api, user);
    const { client } = await passwordStep(user);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.post('/api/auth/mfa/totp/verify', { code: '000000' }),
      ),
    );
    const codes = results.map((r) => r.json().error.code as string);
    // Five wrong codes are evaluated (the account allows six); the rest find the
    // sign-in used up without their code being checked.
    expect(codes.filter((c) => c === 'invalid_code')).toHaveLength(5);
    expect(codes.filter((c) => c === 'session_expired')).toHaveLength(15);
    expect(await failedGuesses(user)).toBe(5);
    const { rows } = await api.admin.query(
      'SELECT failed_mfa_count FROM auth.login_attempt WHERE user_account_id = $1',
      [user.userAccountId],
    );
    expect(rows.map((r) => r.failed_mfa_count)).toContain(5);
    const right = await client.post('/api/auth/mfa/totp/verify', { code: nextCode(api, user) });
    expect(right.json().error.code).toBe('session_expired');
  });

  it('evaluates at most six guesses per account lock window across parallel sign-ins', async () => {
    const user = await staff();
    await signIn(api, user);
    const attempts = [await passwordStep(user), await passwordStep(user), await passwordStep(user)];
    const guess = () =>
      Promise.all(
        attempts.flatMap(({ client }) =>
          Array.from({ length: 10 }, () =>
            client.post('/api/auth/mfa/totp/verify', { code: '000000' }),
          ),
        ),
      );
    const first = (await guess()).map((r) => r.json().error.code as string);
    // THROTTLE_POLICY.account: five free failures and the one that locks.
    expect(first.filter((c) => c === 'invalid_code')).toHaveLength(6);
    expect(first.filter((c) => c === 'too_many_attempts').length).toBeGreaterThan(0);
    expect(await failedGuesses(user)).toBe(6);
    // Refused guesses gave their reservation back to the pending sign-ins.
    const { rows } = await api.admin.query(
      `SELECT sum(failed_mfa_count)::int AS n FROM auth.login_attempt
       WHERE user_account_id = $1 AND consumed_at IS NULL`,
      [user.userAccountId],
    );
    expect(rows[0]).toEqual({ n: 6 });

    // The next lock window (after the 60 s lock): one more guess, then locked again.
    await ageThrottle(api, [accountKey(user.email).hash], 61);
    const fresh = [await passwordStep(user)];
    attempts.splice(0, attempts.length, ...fresh);
    const second = (await guess()).map((r) => r.json().error.code as string);
    expect(second.filter((c) => c === 'invalid_code')).toHaveLength(1);
    expect(await failedGuesses(user)).toBe(7);
  });

  it('reserves step-up guesses the same way', async () => {
    const user = await staff();
    const client = await signIn(api, user);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.post('/api/auth/reauth/totp', { code: '000000' })),
    );
    const codes = results.map((r) => r.json().error.code as string);
    expect(codes.filter((c) => c === 'invalid_code')).toHaveLength(6);
    expect(codes.filter((c) => c === 'too_many_attempts')).toHaveLength(14);
  });

  it('keeps at most three pending sign-ins per user, closing the oldest', async () => {
    const user = await staff();
    await signIn(api, user);
    const attempts = [];
    for (let i = 0; i < 4; i++) attempts.push(await passwordStep(user));
    const oldest = await attempts[0]!.client.post('/api/auth/mfa/totp/verify', {
      code: nextCode(api, user),
    });
    expect(oldest.json().error.code).toBe('session_expired');
    const newest = await attempts[3]!.client.post('/api/auth/mfa/totp/verify', {
      code: nextCode(api, user),
    });
    expect(newest.statusCode).toBe(200);
  });

  it('lets only one of two concurrent requests use the same TOTP code', async () => {
    const user = await staff();
    await signIn(api, user);
    const code = nextCode(api, user);
    const [x, y] = [await passwordStep(user), await passwordStep(user)];
    const results = await Promise.all([
      x.client.post('/api/auth/mfa/totp/verify', { code }),
      y.client.post('/api/auth/mfa/totp/verify', { code }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('lets only one of two concurrent enrollments spend the same enrollment token', async () => {
    const user = await staff();
    const [x, y] = [await passwordStep(user), await passwordStep(user)];
    const enrollmentToken = user.enrollmentToken;
    const secrets = await Promise.all(
      [x, y].map(async ({ client }) =>
        (await import('@deemed/auth')).secretFromBase32(
          (await client.post('/api/auth/mfa/totp/enroll', { enrollmentToken })).json().secret,
        ),
      ),
    );
    api.clock.advance({ seconds: 30 });
    const now = api.clock.now();
    const { generateTotp } = await import('@deemed/auth');
    const results = await Promise.all(
      [x, y].map(({ client }, i) =>
        client.post('/api/auth/mfa/totp/enroll/verify', {
          enrollmentToken,
          code: generateTotp(secrets[i]!, now),
        }),
      ),
    );
    // Exactly one wins; the other is refused (spent token or a newer pending secret).
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.find((r) => r.statusCode !== 200)?.statusCode).toBeGreaterThanOrEqual(400);
    const { rows } = await api.admin.query(
      `SELECT count(*)::int AS n FROM auth.auth_factor
       WHERE user_account_id = $1 AND verified_at IS NOT NULL AND revoked_at IS NULL`,
      [user.userAccountId],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('manifest', () => {
  it('declares routes the tests above exercise', () => {
    expect(Object.keys(ROUTES).length).toBeGreaterThan(10);
  });
});
