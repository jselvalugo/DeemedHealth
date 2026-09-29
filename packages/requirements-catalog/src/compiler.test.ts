import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';
import { compileCatalog, compareCatalogVersions, type CatalogSources } from './compiler.js';
import { effectiveAtRiskDays } from './conventions.js';
import { loadCatalogSources } from './loader.js';

// Synthetic register and entries (TEST- ids). Not real catalog content.
const verifiedSource = (key: string) => ({
  key,
  title: `Synthetic ${key}`,
  url: `https://example.test/${key}`,
  locator: null,
  version: '1',
  verifiedOn: '2026-09-01',
  verifiedBy: 'tester',
  jurisdiction: key.startsWith('FL-') ? 'florida' : 'federal',
  status: 'verified',
});
const register = {
  sources: [
    verifiedSource('CM'),
    verifiedSource('FL-456'),
    { ...verifiedSource('SVP'), url: null, verifiedOn: null, verifiedBy: null, status: 'draft' },
  ],
};

function entry(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    chapter: 5,
    title: `Synthetic ${id}`,
    statement: 'Synthetic statement for compiler tests.',
    layer: 'requirement',
    sources: [
      {
        key: 'CM',
        locator: 'Chapter 5',
        url: 'https://example.test/cm',
        verifiedOn: '2026-09-01',
        verifiedBy: 'tester',
      },
    ],
    appliesTo: { awardTypes: ['section330', 'lookalike'] },
    cadence: null,
    severity: 'high',
    effective: { from: '2020-01-01', to: null },
    status: 'verified',
    ...over,
  };
}

const src = (...entries: Record<string, unknown>[]): CatalogSources => ({
  register,
  entries: entries.map((e) => ({ file: `entries/${String(e.id)}.yaml`, data: e })),
});

const codes = (r: ReturnType<typeof compileCatalog>) => r.diagnostics.map((d) => d.code);

describe('compileCatalog on the real entries', () => {
  it('compiles the draft entries: non-production has them all, production is empty and says so', async () => {
    const result = compileCatalog(await loadCatalogSources(), { catalogVersion: '0.1.0' });
    expect(result.ok, result.summary.join('\n')).toBe(true);
    expect(result.nonProduction!.entries.length).toBeGreaterThanOrEqual(6);
    expect(result.nonProduction!.entries.every((e) => e.status === 'draft')).toBe(true);
    expect(result.production!.entries).toEqual([]);
    expect(result.production!.sources).toEqual([]);
    expect(result.production!.excluded.draft).toBe(result.nonProduction!.entries.length);
    expect(result.productionEmpty).toBe(true);
    expect(result.productionMessage).toMatch(/Production catalog bundle is EMPTY/);
    expect(result.summary.join('\n')).toMatch(/EMPTY/);
  });

  it('is deterministic: the same sources and version give byte-identical bundles', async () => {
    const a = compileCatalog(await loadCatalogSources(), { catalogVersion: '0.1.0' });
    const b = compileCatalog(await loadCatalogSources(), { catalogVersion: '0.1.0' });
    expect(JSON.stringify(a.nonProduction)).toBe(JSON.stringify(b.nonProduction));
    expect(a.nonProduction!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('bundles', () => {
  it('puts only verified entries (and their sources) in the production bundle', () => {
    const r = compileCatalog(
      src(
        entry('TEST-05-A'),
        entry('TEST-05-B', { status: 'draft' }),
        entry('TEST-05-OLD', { status: 'retired', effective: { from: '2019-01-01', to: '2019-12-31' } }),
      ),
      { catalogVersion: '1.0.0' },
    );
    expect(r.ok, r.summary.join('\n')).toBe(true);
    expect(r.nonProduction!.entries.map((e) => e.id)).toEqual(['TEST-05-A', 'TEST-05-B', 'TEST-05-OLD']);
    expect(r.production!.entries.map((e) => e.id)).toEqual(['TEST-05-A']);
    expect(r.production!.sources.map((s) => s.key)).toEqual(['CM']);
    expect(r.production!.excluded).toEqual({ draft: 1, retired: 1 });
    expect(r.productionEmpty).toBe(false);
    expect(r.productionMessage).toMatch(/holds 1 of 3/);
  });

  it('hash changes when content changes and entries are sorted by id', () => {
    const one = compileCatalog(src(entry('TEST-05-B'), entry('TEST-05-A')), {
      catalogVersion: '1.0.0',
    });
    const two = compileCatalog(src(entry('TEST-05-A'), entry('TEST-05-B', { severity: 'low' })), {
      catalogVersion: '1.0.0',
    });
    expect(one.nonProduction!.entries.map((e) => e.id)).toEqual(['TEST-05-A', 'TEST-05-B']);
    expect(one.nonProduction!.contentHash).not.toBe(two.nonProduction!.contentHash);
    expect(one.nonProduction!.entries[0]!.entryHash).toBe(two.nonProduction!.entries[0]!.entryHash);
  });

  it('records added, changed, and retired entries against the previous release', () => {
    const v1 = compileCatalog(src(entry('TEST-05-A'), entry('TEST-05-B')), {
      catalogVersion: '1.0.0',
    });
    const v2 = compileCatalog(
      src(
        entry('TEST-05-A', { severity: 'low' }),
        entry('TEST-05-B', { status: 'retired', effective: { from: '2020-01-01', to: '2026-01-01' } }),
        entry('TEST-05-C'),
      ),
      {
        catalogVersion: '1.1.0',
        previous: { nonProduction: v1.nonProduction!, production: v1.production! },
      },
    );
    expect(v2.ok, v2.summary.join('\n')).toBe(true);
    expect(v2.nonProduction!.changeset.map((c) => [c.requirementId, c.change])).toEqual([
      ['TEST-05-A', 'changed'],
      ['TEST-05-B', 'retired'],
      ['TEST-05-C', 'added'],
    ]);
    // In production, B leaves the bundle: still a retirement.
    expect(v2.production!.changeset.map((c) => [c.requirementId, c.change])).toEqual([
      ['TEST-05-A', 'changed'],
      ['TEST-05-B', 'retired'],
      ['TEST-05-C', 'added'],
    ]);
  });
});

describe('validation (ADR-0003 rule 11)', () => {
  it('rejects schema errors, duplicate ids, and a bad version', () => {
    const r = compileCatalog(
      src(entry('TEST-05-A'), entry('TEST-05-A'), { id: 'TEST-05-X', chapter: 5 }),
      { catalogVersion: 'v1' },
    );
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['version_invalid', 'duplicate_id', 'schema']));
    expect(r.nonProduction).toBeNull();
    expect(r.summary[0]).toMatch(/FAILED/);
  });

  it('rejects unregistered sources and verified entries citing unverified sources (rule 8)', () => {
    const r = compileCatalog(
      src(
        entry('TEST-05-A', {
          sources: [
            { key: 'NOPE', locator: 'x', url: 'https://example.test', verifiedOn: '2026-09-01', verifiedBy: 't' },
          ],
        }),
        entry('TEST-05-B', {
          sources: [
            { key: 'SVP', locator: 'x', url: 'https://example.test', verifiedOn: '2026-09-01', verifiedBy: 't' },
          ],
        }),
      ),
      { catalogVersion: '1.0.0' },
    );
    expect(codes(r)).toEqual(['source_unregistered', 'source_not_verified']);
  });

  it('applies the catalog conventions: labeling, awardTypes, cadence', () => {
    const r = compileCatalog(
      src(
        // An FL- id presented as an HRSA requirement.
        entry('FL-456-X', { chapter: null }),
        // No awardTypes.
        entry('TEST-05-NOAWARD', { appliesTo: {} }),
        // A periodic cadence without cadenceBasis.
        entry('TEST-05-PERIODIC', {
          cadence: { trigger: 'periodic', renewalMonths: 12, leadDays: [30] },
        }),
      ),
      { catalogVersion: '1.0.0' },
    );
    expect(r.ok).toBe(false);
    const byId = (id: string) => r.diagnostics.filter((d) => d.requirementId === id).map((d) => d.code);
    expect(byId('FL-456-X')).toEqual(expect.arrayContaining(['convention', 'fl_label']));
    expect(byId('TEST-05-NOAWARD')).toContain('convention');
    expect(byId('TEST-05-PERIODIC')).toContain('convention');
  });

  it('rejects cadence.atRiskDays beyond the largest lead day, and defaults it to 30 capped there (F6)', () => {
    const cadence = (atRiskDays?: number) => ({
      trigger: 'on_expiration',
      renewalMonths: null,
      leadDays: [60, 30, 0],
      ...(atRiskDays === undefined ? {} : { atRiskDays }),
    });
    const bad = compileCatalog(src(entry('TEST-05-RISK', { cadence: cadence(90) })), {
      catalogVersion: '1.0.0',
    });
    expect(bad.diagnostics.map((d) => d.message).join(' ')).toMatch(/atRiskDays/);
    const ok = compileCatalog(src(entry('TEST-05-RISK', { cadence: cadence(45) })), {
      catalogVersion: '1.0.0',
    });
    expect(ok.ok, ok.summary.join('\n')).toBe(true);
    expect(effectiveAtRiskDays({ leadDays: [90, 60, 30, 0] })).toBe(30);
    expect(effectiveAtRiskDays({ leadDays: [14, 7] })).toBe(14);
    expect(effectiveAtRiskDays({ leadDays: [90], atRiskDays: 45 })).toBe(45);
  });

  it('accepts a well-labeled Florida entry', () => {
    const r = compileCatalog(
      src(
        entry('FL-456-OK', {
          chapter: null,
          layer: 'state_requirement',
          appliesTo: { awardTypes: ['section330', 'lookalike'], jurisdiction: 'florida' },
          sources: [
            { key: 'FL-456', locator: 's. 456', url: 'https://example.test/fl', verifiedOn: '2026-09-01', verifiedBy: 't' },
          ],
        }),
      ),
      { catalogVersion: '1.0.0' },
    );
    expect(r.ok, r.summary.join('\n')).toBe(true);
  });

  it('checks supersession: unknown target, not retired, overlapping dates, cycles', () => {
    const r = compileCatalog(
      src(
        entry('TEST-05-NEW', { supersedes: ['TEST-05-GONE'] }),
        entry('TEST-05-NEW2', { supersedes: ['TEST-05-LIVE'] }),
        entry('TEST-05-LIVE'),
        entry('TEST-05-NEW3', {
          effective: { from: '2021-01-01', to: null },
          supersedes: ['TEST-05-OLD'],
        }),
        entry('TEST-05-OLD', { status: 'retired', effective: { from: '2019-01-01', to: '2021-06-30' } }),
        entry('TEST-05-C1', { supersedes: ['TEST-05-C2'] }),
        entry('TEST-05-C2', { supersedes: ['TEST-05-C1'] }),
      ),
      { catalogVersion: '1.0.0' },
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        'supersedes_unknown',
        'supersedes_not_retired',
        'supersedes_overlap',
        'supersedes_cycle',
      ]),
    );
  });

  it('keeps ids stable across releases: never removed, a retired id never returns, versions increase', () => {
    const v1 = compileCatalog(
      src(
        entry('TEST-05-A'),
        entry('TEST-05-R', { status: 'retired', effective: { from: '2019-01-01', to: '2019-12-31' } }),
      ),
      { catalogVersion: '1.0.0' },
    );
    const v2 = compileCatalog(src(entry('TEST-05-R')), {
      catalogVersion: '1.0.0',
      previous: { nonProduction: v1.nonProduction! },
    });
    expect(codes(v2)).toEqual(
      expect.arrayContaining(['id_removed', 'id_reused', 'version_not_increasing']),
    );
  });

  it('warns when the file name is not <requirementId>.yaml', () => {
    const r = compileCatalog(
      { register, entries: [{ file: 'entries/whatever.yaml', data: entry('TEST-05-A') }] },
      { catalogVersion: '1.0.0' },
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([expect.objectContaining({ level: 'warning', code: 'file_name' })]);
  });
});

describe('helpers', () => {
  it('orders catalog versions numerically', () => {
    expect(compareCatalogVersions('2026.10.0', '2026.9.3')).toBe(1);
    expect(compareCatalogVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareCatalogVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(() => compareCatalogVersions('x', '1.0.0')).toThrow();
  });

  it('canonicalJson sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: undefined, c: 'x' }] })).toBe('{"a":[1,{"c":"x"}],"b":1}');
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});
