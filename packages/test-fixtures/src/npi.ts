/**
 * Synthetic NPI generator and validator.
 *
 * An NPI is 10 digits: a 9-digit base plus a Luhn check digit computed over the
 * base with the ISO card-issuer prefix "80840" prepended (CMS NPI standard).
 * The 80840 prefix contributes a constant 24 to the Luhn sum.
 *
 * Every NPI produced here is wrapped in a `TestNpi` object with `test: true`,
 * so fixtures can never be mistaken for, or silently mixed with, real
 * identifiers. Values are derived deterministically from a numeric seed.
 */

export const NPI_LUHN_PREFIX = '80840';

export interface TestNpi {
  readonly value: string;
  readonly test: true;
  readonly source: 'synthetic';
}

/** Luhn check digit for a digit string (check digit appended on the right). */
export function luhnCheckDigit(payload: string): number {
  if (!/^\d+$/.test(payload)) throw new Error('luhnCheckDigit: payload must be digits');
  let sum = 0;
  // Rightmost payload digit is doubled (it sits left of the check digit).
  for (let i = 0; i < payload.length; i++) {
    let d = payload.charCodeAt(payload.length - 1 - i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Check digit for a 9-digit NPI base. */
export function npiCheckDigit(base9: string): number {
  if (!/^\d{9}$/.test(base9)) throw new Error('npiCheckDigit: base must be exactly 9 digits');
  return luhnCheckDigit(NPI_LUHN_PREFIX + base9);
}

/** True when the value is a 10-digit, first-digit 1 or 2, Luhn-valid NPI. */
export function isValidNpi(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[12]\d{9}$/.test(value)) return false;
  return npiCheckDigit(value.slice(0, 9)) === Number(value[9]);
}

/**
 * Deterministic synthetic NPI from a seed (0 <= seed < 100,000,000).
 * Type 1 (individual) NPIs start with 1, type 2 (organization) with 2.
 */
export function makeTestNpi(seed: number, entityType: 1 | 2 = 1): TestNpi {
  if (!Number.isInteger(seed) || seed < 0 || seed >= 100_000_000) {
    throw new RangeError('makeTestNpi: seed must be an integer in [0, 1e8)');
  }
  const base = `${entityType}${String(seed).padStart(8, '0')}`;
  return Object.freeze({ value: base + npiCheckDigit(base), test: true, source: 'synthetic' });
}

/** Type guard: only objects produced by makeTestNpi (flagged test) pass. */
export function isTestNpi(x: unknown): x is TestNpi {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as TestNpi).test === true &&
    (x as TestNpi).source === 'synthetic' &&
    isValidNpi((x as TestNpi).value)
  );
}
