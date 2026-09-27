import { describe, expect, it } from 'vitest';
import { messages, t, toLocale } from './index.js';

describe('i18n', () => {
  it('defaults to English', () => {
    expect(toLocale(undefined)).toBe('en');
    expect(toLocale('fr')).toBe('en');
    expect(toLocale('es')).toBe('es');
  });
  it('has every English key in Spanish', () => {
    expect(Object.keys(messages.es).sort()).toEqual(Object.keys(messages.en).sort());
    expect(t('en', 'preview.banner')).toBe(
      'PREVIEW · Synthetic data only. Do not enter real patient information.',
    );
  });
});
