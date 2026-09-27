import { describe, expect, it } from 'vitest';
import { isProduction, parseDhEnv } from './environment.js';

describe('DH_ENV', () => {
  it('treats only the exact string "production" as production', () => {
    expect(isProduction('production')).toBe(true);
    for (const v of [undefined, '', 'Production', 'prod', 'staging', 'preview', 'local']) {
      expect(isProduction(v)).toBe(false);
    }
  });
  it('rejects missing or unknown values', () => {
    expect(() => parseDhEnv(undefined)).toThrow();
    expect(() => parseDhEnv('prod')).toThrow();
    expect(parseDhEnv('staging')).toBe('staging');
  });
});
