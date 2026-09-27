import { describe, expect, it } from 'vitest';
import { messages, t, tCount, toLocale } from './index.js';

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

  it('has no empty strings and keeps placeholders consistent across locales', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(messages.en) as (keyof typeof messages.en)[]) {
      expect(messages.en[key].trim(), key).not.toBe('');
      expect(messages.es[key].trim(), key).not.toBe('');
      expect(vars(messages.es[key]), key).toEqual(vars(messages.en[key]));
    }
  });

  it('fills placeholders and plural forms', () => {
    expect(t('en', 'home.greeting', { name: 'Dana' })).toBe('Welcome, Dana');
    expect(tCount('en', 'launcher.modules', 1)).toBe('1 module');
    expect(tCount('en', 'launcher.modules', 16)).toBe('16 modules');
    expect(tCount('es', 'launcher.pages', 2)).toBe('2 páginas');
  });
});
