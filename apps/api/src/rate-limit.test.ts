/**
 * Rate limiting (CodeQL js/missing-rate-limiting): a global per-address limit on every
 * route and a tighter one on sign-in and step-up routes. Also proves request logs carry
 * no client address (security review finding 5).
 */
import { Writable } from 'node:stream';
import type { AuthService } from '@deemed/auth';
import type { Database } from '@deemed/db';
import { describe, expect, it } from 'vitest';
import { buildApp, RATE_LIMIT_DEFAULTS, type BuildAppOptions } from './app.js';

// A stand-in sign-in service: the password step always "continues to MFA".
const auth = {
  revokePresentedSession: async () => undefined,
  login: async () => ({ loginToken: 'v1.stub', next: 'mfa', methods: ['totp'] }),
} as unknown as AuthService;

function app(extra: Partial<BuildAppOptions> = {}) {
  return buildApp({
    database: {} as Database,
    auth,
    clock: { now: () => new Date() },
    dhEnv: 'local',
    allowedOrigins: ['https://app.test'],
    secureCookies: true,
    ...extra,
  });
}

const login = (a: ReturnType<typeof app>, ip: string) =>
  a.inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: ip,
    headers: { origin: 'https://app.test', 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'a@b.example', password: 'wrong password here' }),
  });

describe('rate limits', () => {
  it('ship with 300/min globally and 30/min on sign-in steps', () => {
    expect(RATE_LIMIT_DEFAULTS).toEqual({ globalPerMinute: 300, signinPerMinute: 30 });
  });

  it('limit every route per client address (global)', async () => {
    const a = app({ rateLimit: { globalPerMinute: 3, signinPerMinute: 100 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await a.inject({ url: '/api/health', remoteAddress: '192.0.2.1' })).statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429]);
    const limited = await a.inject({ url: '/api/health', remoteAddress: '192.0.2.1' });
    expect(limited.json()).toEqual({
      error: {
        code: 'too_many_attempts',
        messageKey: 'apiError.too_many_attempts',
        correlationId: limited.headers['x-request-id'],
      },
    });
    // Another address has its own budget.
    expect((await a.inject({ url: '/api/health', remoteAddress: '192.0.2.2' })).statusCode).toBe(
      200,
    );
    await a.close();
  });

  it('limit sign-in steps more tightly than the rest (per route)', async () => {
    const a = app({ rateLimit: { globalPerMinute: 100, signinPerMinute: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await login(a, '192.0.2.9')).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    // Other routes from the same address are still under the global limit.
    expect((await a.inject({ url: '/api/health', remoteAddress: '192.0.2.9' })).statusCode).toBe(
      200,
    );
    await a.close();
  });
});

describe('request logging', () => {
  it('logs request id, route id, status, and duration, and never the client address', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const a = app({ logger: { level: 'info', stream } });
    await a.inject({ url: '/api/health', remoteAddress: '198.51.100.77' });
    await a.inject({ url: '/api/nope', remoteAddress: '198.51.100.77' });
    await a.close();
    const text = lines.join('');
    expect(text).not.toContain('198.51.100.77');
    expect(text).not.toContain('remoteAddress');
    const completed = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === 'request completed');
    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({ routeId: 'health', statusCode: 200 });
    expect(Object.keys(completed[0]).sort()).toEqual(
      expect.arrayContaining(['durationMs', 'requestId', 'routeId', 'statusCode']),
    );
  });
});

describe('trustProxy', () => {
  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    const seen: string[] = [];
    const plain = app();
    plain.addHook('onRequest', async (req) => void seen.push(req.ip));
    await plain.inject({
      url: '/api/health',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    const trusted = app({ trustProxy: ['10.0.0.0/8'] });
    trusted.addHook('onRequest', async (req) => void seen.push(req.ip));
    await trusted.inject({
      url: '/api/health',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(seen).toEqual(['10.0.0.5', '203.0.113.9']);
    await plain.close();
    await trusted.close();
  });
});
