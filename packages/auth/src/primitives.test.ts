import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isBreachedPassword } from './breached-passwords.js';
import { FakeClock } from './clock.js';
import { checkNewPassword, hashPassword, verifyPassword } from './password.js';
import { THROTTLE_POLICY } from './policy.js';
import { open, seal } from './secret-box.js';
import {
  accountKey,
  ipKey,
  ipPrefix,
  isLocked,
  recordFailure,
  type ThrottleState,
} from './throttle.js';
import { csrfTokenFor, isUuid, issueToken, parseToken } from './tokens.js';
import { generateTotp, isTotpFormat, newTotpSecret, totpStep, verifyTotp } from './totp.js';

const ORG = '0f000000-0000-4000-8000-000000000001';
const OTHER = '0f000000-0000-4000-8000-000000000002';

describe('tokens', () => {
  it('carry the organization id and store only a digest', () => {
    const t = issueToken(ORG);
    expect(t.token.startsWith(`v1.${ORG}.`)).toBe(true);
    expect(t.hash).toHaveLength(32);
    const parsed = parseToken(t.token);
    expect(parsed?.organizationId).toBe(ORG);
    expect(parsed?.hash.equals(t.hash)).toBe(true);
    expect(issueToken(ORG).token).not.toBe(t.token);
  });

  it('reject anything malformed without throwing', () => {
    const t = issueToken(ORG).token;
    for (const bad of [
      undefined,
      '',
      'v1',
      `v2.${ORG}.${t.split('.')[2]}`,
      `v1.not-a-uuid.${t.split('.')[2]}`,
      `v1.${ORG}.short`,
      `v1.${ORG}.${'a'.repeat(42)}!`,
      `${t}.extra`,
      'x'.repeat(10_000),
    ]) {
      expect(parseToken(bad)).toBeNull();
    }
    expect(isUuid(ORG)).toBe(true);
    expect(isUuid(ORG.toUpperCase())).toBe(false);
  });

  it('derive a CSRF token per session that needs the server key', () => {
    const key = randomBytes(32);
    expect(csrfTokenFor(key, ORG)).toBe(csrfTokenFor(key, ORG));
    expect(csrfTokenFor(key, ORG)).not.toBe(csrfTokenFor(key, OTHER));
    expect(csrfTokenFor(randomBytes(32), ORG)).not.toBe(csrfTokenFor(key, ORG));
  });
});

describe('passwords (ADR-0006 rule 2)', () => {
  it('require 12+ characters and reject breached and email-derived passwords', () => {
    expect(checkNewPassword('short')).toBe('too_short');
    expect(checkNewPassword('x'.repeat(257))).toBe('too_long');
    expect(checkNewPassword('Password1234')).toBe('breached');
    expect(checkNewPassword('Password9876!!')).toBe('breached');
    expect(checkNewPassword('QWERTY123456')).toBe('breached');
    expect(checkNewPassword('angela.morales-garden-7', 'angela.morales@xyz-chc.example')).toBe(
      'contains_email',
    );
    expect(checkNewPassword('violet tram under glass')).toBeNull();
    expect(isBreachedPassword('violet tram under glass')).toBe(false);
  });

  it('hash with Argon2id and verify', async () => {
    const phc = await hashPassword('violet tram under glass');
    expect(phc.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(phc, 'violet tram under glass')).toBe(true);
    expect(await verifyPassword(phc, 'violet tram under grass')).toBe(false);
    expect(await verifyPassword(undefined, 'anything at all here')).toBe(false);
    expect(await verifyPassword('not a phc string', 'anything at all here')).toBe(false);
    await expect(hashPassword('password1234')).rejects.toThrow('breached');
  });
});

describe('TOTP with a fake clock', () => {
  const clock = new FakeClock('2026-09-27T12:00:10.000Z');
  const secret = newTotpSecret().bytes;

  it('accepts the current code and one step of skew, then refuses a replay', () => {
    const now = clock.now();
    const code = generateTotp(secret, now);
    const step = verifyTotp(secret, code, now, null);
    expect(step).toBe(totpStep(now));
    expect(verifyTotp(secret, code, now, step)).toBeNull();

    const previous = generateTotp(secret, new Date(now.getTime() - 30_000));
    expect(verifyTotp(secret, previous, now, null)).toBe(totpStep(now) - 1);
    const old = generateTotp(secret, new Date(now.getTime() - 90_000));
    expect(verifyTotp(secret, old, now, null)).toBeNull();
  });

  it('expires codes as the clock moves', () => {
    const at = clock.now();
    const code = generateTotp(secret, at);
    clock.advance({ seconds: 95 });
    expect(verifyTotp(secret, code, clock.now(), null)).toBeNull();
  });

  it('checks the format with a loop', () => {
    expect(isTotpFormat('123456')).toBe(true);
    for (const bad of ['12345', '1234567', '12a456', '']) expect(isTotpFormat(bad)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', clock.now(), null)).toBeNull();
  });
});

describe('secret box (interim field encryption)', () => {
  const key = { root: randomBytes(32) };

  it('round-trips and binds the organization and purpose', () => {
    const sealed = seal(key, ORG, 'totp-secret', Buffer.from('secret'));
    expect(open(key, ORG, 'totp-secret', sealed).toString()).toBe('secret');
    expect(() => open(key, OTHER, 'totp-secret', sealed)).toThrow();
    expect(() => open(key, ORG, 'other', sealed)).toThrow();
    expect(() => open({ root: randomBytes(32) }, ORG, 'totp-secret', sealed)).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
    expect(() => open(key, ORG, 'totp-secret', tampered)).toThrow();
    expect(() => seal({ root: randomBytes(16) }, ORG, 'x', Buffer.from('a'))).toThrow();
  });
});

describe('throttling with a fake clock (ADR-0006 rule 11)', () => {
  it('locks an account progressively after the free failures', () => {
    const clock = new FakeClock('2026-09-27T12:00:00.000Z');
    let state: ThrottleState | undefined;
    const locks: number[] = [];
    for (let i = 1; i <= THROTTLE_POLICY.account.freeFailures + 3; i++) {
      const next = recordFailure('account', state, clock.now());
      state = next;
      if (next.lockedNow) locks.push((next.lockedUntil!.getTime() - clock.now().getTime()) / 1000);
      clock.advance({ seconds: 1 });
    }
    expect(locks).toEqual([60, 120, 240]);
    expect(isLocked(state, clock.now())).toBe(true);
    clock.advance({ minutes: 5 });
    expect(isLocked(state, clock.now())).toBe(false);
  });

  it('caps the lock and starts a new window after a quiet period', () => {
    const clock = new FakeClock('2026-09-27T12:00:00.000Z');
    let state: ThrottleState = { failures: 40, windowStartedAt: clock.now(), lockedUntil: null };
    const next = recordFailure('account', state, clock.now());
    expect((next.lockedUntil!.getTime() - clock.now().getTime()) / 1000).toBe(3600);
    state = { failures: 3, windowStartedAt: clock.now(), lockedUntil: null };
    clock.advance({ minutes: 16 });
    expect(recordFailure('account', state, clock.now()).failures).toBe(1);
  });

  it('keys by email and IP prefix, never by the raw value', () => {
    expect(accountKey('A@B.example').hash.equals(accountKey(' a@b.example ').hash)).toBe(true);
    expect(ipPrefix('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(ipPrefix('::ffff:192.0.2.7')).toBe('192.0.2.7');
    expect(ipKey('192.0.2.7').hash).toHaveLength(32);
  });

  it('normalizes IPv6 to its /64, whatever the spelling (compressed, case, zeros, zone)', () => {
    const net = '2001:db8:0:0::/64';
    for (const spelling of [
      '2001:db8::1',
      '2001:db8::ffff:2',
      '2001:DB8:0:0:1:2:3:4',
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '2001:db8:0:0::',
    ]) {
      expect(ipPrefix(spelling), spelling).toBe(net);
    }
    // Compressed forms used to keep the whole address (every host its own key).
    expect(ipKey('2001:db8::1').hash).toEqual(ipKey('2001:db8::2').hash);
    // Another /64 is another key; a group after `::` is not part of the prefix.
    expect(ipPrefix('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64');
    expect(ipPrefix('2001:db8::1:0:0:1')).toBe(net);
    expect(ipPrefix('::1')).toBe('0:0:0:0::/64');
    expect(ipPrefix('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipPrefix('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    // IPv4-mapped, dotted or hex, is the IPv4 address.
    expect(ipPrefix('::ffff:c000:207')).toBe('192.0.2.7');
    expect(ipPrefix(' 192.0.2.7 ')).toBe('192.0.2.7');
    expect(ipPrefix('not-an-address')).toBe('not-an-address');
  });
});
