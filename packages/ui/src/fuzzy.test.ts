import { describe, expect, it } from 'vitest';
import { t } from '@deemed/i18n';
import { fuzzyMatch, searchModules } from './fuzzy.js';
import { MODULES } from './module-registry.js';

describe('fuzzyMatch', () => {
  it('matches substrings, word starts, and subsequences', () => {
    expect(fuzzyMatch('cred', 'Credentialing')?.ranges).toEqual([[0, 4]]);
    expect(fuzzyMatch('ver', 'Site visit prep')).toBeNull();
    expect(fuzzyMatch('svp', 'Site visit prep')).not.toBeNull();
    expect(fuzzyMatch('zzz', 'Providers')).toBeNull();
  });

  it('ignores case and accents and highlights the original text', () => {
    const m = fuzzyMatch('modulo', 'Módulo');
    expect(m?.ranges).toEqual([[0, 6]]);
  });

  it('ranks a word-start substring above a mid-word one', () => {
    const a = fuzzyMatch('pay', 'Payers')!.score;
    const b = fuzzyMatch('pay', 'Repayment')!.score;
    expect(a).toBeGreaterThan(b);
  });
});

describe('searchModules', () => {
  const label = (k: Parameters<typeof t>[1]) => t('en', k);

  it('returns everything for an empty query', () => {
    expect(searchModules(MODULES, '  ', label)).toHaveLength(MODULES.length);
  });

  it('keeps all pages when the module matches, only matching pages otherwise', () => {
    const byModule = searchModules(MODULES, 'screening', label);
    expect(byModule[0]!.module.id).toBe('screening');
    expect(byModule[0]!.pages).toHaveLength(3);

    const byPage = searchModules(MODULES, 'expirations', label);
    expect(byPage.map((r) => r.module.id)).toEqual(['providers']);
    expect(byPage[0]!.pages.map((p) => p.page.id)).toEqual(['expirations']);
  });

  it('searches the Spanish names in Spanish', () => {
    const es = searchModules(MODULES, 'gobernanza', (k) => t('es', k));
    expect(es[0]!.module.id).toBe('governance');
  });
});
