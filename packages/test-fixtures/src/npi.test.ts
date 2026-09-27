import { describe, expect, it } from 'vitest';
import { isTestNpi, isValidNpi, luhnCheckDigit, makeTestNpi, npiCheckDigit } from './npi';

describe('npiCheckDigit', () => {
  it('matches the CMS worked example (123456789 -> 3)', () => {
    expect(npiCheckDigit('123456789')).toBe(3);
  });
  it('rejects bases that are not 9 digits', () => {
    expect(() => npiCheckDigit('12345678')).toThrow();
    expect(() => npiCheckDigit('12345678a')).toThrow();
  });
  it('equals the plain Luhn digit over the 80840-prefixed payload', () => {
    expect(npiCheckDigit('123456789')).toBe(luhnCheckDigit('80840123456789'));
  });
});

describe('luhnCheckDigit', () => {
  it('computes a known credit-card-style example', () => {
    expect(luhnCheckDigit('7992739871')).toBe(3);
  });
  it('rejects non-digits', () => {
    expect(() => luhnCheckDigit('')).toThrow();
    expect(() => luhnCheckDigit('12-3')).toThrow();
  });
});

describe('isValidNpi', () => {
  it('accepts a Luhn-valid NPI', () => {
    expect(isValidNpi('1234567893')).toBe(true);
  });
  it('rejects a wrong check digit', () => {
    expect(isValidNpi('1234567890')).toBe(false);
  });
  it('rejects wrong length, bad leading digit, and non-strings', () => {
    expect(isValidNpi('123456789')).toBe(false);
    expect(isValidNpi('12345678931')).toBe(false);
    expect(isValidNpi('3234567893')).toBe(false);
    expect(isValidNpi(1234567893)).toBe(false);
    expect(isValidNpi(null)).toBe(false);
  });
  it('detects every single-digit substitution', () => {
    const good = '1234567893';
    for (let pos = 0; pos < 10; pos++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === good[pos]) continue;
        const bad = good.slice(0, pos) + d + good.slice(pos + 1);
        expect(isValidNpi(bad)).toBe(false);
      }
    }
  });
});

describe('makeTestNpi', () => {
  it('produces valid NPIs flagged as test for a range of seeds', () => {
    for (let seed = 0; seed < 2000; seed++) {
      const npi = makeTestNpi(seed);
      expect(isValidNpi(npi.value)).toBe(true);
      expect(npi.test).toBe(true);
      expect(isTestNpi(npi)).toBe(true);
    }
  });
  it('is deterministic and unique per seed', () => {
    expect(makeTestNpi(42).value).toBe(makeTestNpi(42).value);
    const seen = new Set(Array.from({ length: 1000 }, (_, i) => makeTestNpi(i).value));
    expect(seen.size).toBe(1000);
  });
  it('encodes entity type in the first digit', () => {
    expect(makeTestNpi(7, 1).value[0]).toBe('1');
    expect(makeTestNpi(7, 2).value[0]).toBe('2');
    expect(isValidNpi(makeTestNpi(99_999_999, 2).value)).toBe(true);
  });
  it('returns a frozen object', () => {
    expect(Object.isFrozen(makeTestNpi(1))).toBe(true);
  });
  it('rejects out-of-range or non-integer seeds', () => {
    expect(() => makeTestNpi(-1)).toThrow(RangeError);
    expect(() => makeTestNpi(100_000_000)).toThrow(RangeError);
    expect(() => makeTestNpi(1.5)).toThrow(RangeError);
  });
});

describe('isTestNpi', () => {
  it('rejects bare strings and unflagged objects', () => {
    expect(isTestNpi('1234567893')).toBe(false);
    expect(isTestNpi({ value: '1234567893' })).toBe(false);
    expect(isTestNpi({ value: '1234567890', test: true, source: 'synthetic' })).toBe(false);
    expect(isTestNpi(null)).toBe(false);
  });
});
