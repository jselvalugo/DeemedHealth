import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { redactedDiff } from './audit.js';
import { ConfigError, isCanonicalKey32, loadApiConfig } from './config.js';
import { clearCookie, cookieNames, readCookie, serializeCookie } from './cookies.js';

const base = {
  DH_ENV: 'development',
  DATABASE_URL: 'postgres://app_user@db.example/dh',
  DH_PUBLIC_ORIGIN: 'https://dev.deemed.example',
  DH_DEV_ROOT_KEY: randomBytes(32).toString('base64'),
};

describe('loadApiConfig', () => {
  it('derives origins, WebAuthn relying party, and secure cookies', () => {
    const c = loadApiConfig(base);
    expect(c.allowedOrigins).toEqual(['https://dev.deemed.example']);
    expect(c.webauthn.rpId).toBe('dev.deemed.example');
    expect(c.secureCookies).toBe(true);
  });

  it('fails closed and names variables, never values', () => {
    const secret = 'postgres://app_user:hunter2@db.example/dh';
    try {
      loadApiConfig({ ...base, DATABASE_URL: undefined, DH_ENV: 'prod', DH_PUBLIC_ORIGIN: secret });
      throw new Error('expected a ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).toContain('DH_ENV');
      expect((error as Error).message).not.toContain('hunter2');
    }
    expect(() => loadApiConfig({ ...base, DH_DEV_ROOT_KEY: 'c2hvcnQ=' })).toThrow(ConfigError);
  });

  it('refuses production until the KMS key provider exists, and insecure cookies outside local', () => {
    expect(() => loadApiConfig({ ...base, DH_ENV: 'production' })).toThrow(/KMS/);
    expect(() => loadApiConfig({ ...base, DH_INSECURE_COOKIES: '1' })).toThrow(/local/);
    expect(
      loadApiConfig({ ...base, DH_ENV: 'local', DH_INSECURE_COOKIES: '1' }).secureCookies,
    ).toBe(false);
  });
});

describe('DH_DEV_ROOT_KEY and DH_TRUST_PROXY', () => {
  it('accept only canonical base64 of exactly 32 bytes (openssl rand -base64 32)', () => {
    const good = randomBytes(32).toString('base64');
    expect(isCanonicalKey32(good)).toBe(true);
    expect(loadApiConfig({ ...base, DH_DEV_ROOT_KEY: good }).secretRootKey).toHaveLength(32);
    for (const bad of [
      randomBytes(48).toString('base64'), // too long
      randomBytes(16).toString('base64'), // too short
      good.slice(0, 43) + '*', // not base64
      good.slice(0, 42) + '==', // truncated bytes, still 44 chars
      randomBytes(32).toString('base64url') + '=', // url-safe alphabet
    ]) {
      expect(isCanonicalKey32(bad), bad).toBe(false);
      expect(() => loadApiConfig({ ...base, DH_DEV_ROOT_KEY: bad })).toThrow(/exactly 32 bytes/);
    }
  });

  it('parse trusted proxy CIDRs and refuse anything else', () => {
    expect(loadApiConfig(base).trustProxy).toEqual([]);
    expect(
      loadApiConfig({ ...base, DH_TRUST_PROXY: '10.0.0.0/16, 10.1.0.0/16' }).trustProxy,
    ).toEqual(['10.0.0.0/16', '10.1.0.0/16']);
    expect(() => loadApiConfig({ ...base, DH_TRUST_PROXY: 'true' })).toThrow(ConfigError);
    expect(() => loadApiConfig({ ...base, DH_TRUST_PROXY: '10.0.0.0/8;rm' })).toThrow(ConfigError);
  });
});

describe('cookies', () => {
  it('are host-prefixed, HttpOnly, SameSite=Lax, and Secure', () => {
    const names = cookieNames(true);
    expect(names.session).toBe('__Host-dh_session');
    expect(serializeCookie(names.session, 'v', { maxAgeSeconds: 60, secure: true })).toBe(
      '__Host-dh_session=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure',
    );
    expect(clearCookie('x', true)).toContain('Max-Age=0');
    expect(readCookie('a=1; __Host-dh_session=tok; b=2', '__Host-dh_session')).toBe('tok');
    expect(readCookie('garbage', 'a')).toBeUndefined();
    expect(readCookie('x'.repeat(20_000), 'a')).toBeUndefined();
  });
});

describe('redactedDiff (ADR-0008 section 5)', () => {
  it('keeps changed columns only and redacts PII and field-encrypted values', () => {
    expect(
      redactedDiff(
        'public.person',
        { given_name: 'Ana', npi: '1', work_email: 'a@b.example' },
        {
          given_name: 'Ana María',
          npi: '1',
          work_email: 'c@d.example',
        },
      ),
    ).toEqual({
      fields: {
        given_name: { changed: true, redacted: true },
        work_email: { changed: true, redacted: true },
      },
    });
    expect(
      redactedDiff('public.role_assignment', null, { role_key: 'finance', site_id: null }),
    ).toEqual({
      fields: { role_key: { before: null, after: 'finance' } },
    });
  });

  it('keeps only the length and SHA-256 of free-text reasons', () => {
    const diff = redactedDiff('public.role_assignment', null, {
      role_key: 'finance',
      grant_reason: 'Covering for María Delgado while on leave',
    }) as { fields: Record<string, { after: Record<string, unknown> }> };
    expect(JSON.stringify(diff)).not.toContain('María');
    expect(diff.fields.grant_reason?.after).toEqual({
      redacted: true,
      length: 41,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('refuses columns and tables missing from the column registry', () => {
    expect(() => redactedDiff('public.role_assignment', null, { made_up: 1 })).toThrow(
      /sensitivity class/,
    );
    expect(() => redactedDiff('public.nope', null, {})).toThrow(/data dictionary/);
  });
});
