/**
 * Catalog compiler (ADR-0003 rules 2, 3, 8, 11). Turns the Git source of truth (entry
 * YAML documents and the source register) into two immutable bundles:
 *
 *   - non_production: every entry (draft, verified, retired). Drafts are badged in the UI.
 *   - production:     verified entries only. Drafts and retired entries are excluded, so a
 *                     misconfigured flag can never show a draft to a production tenant.
 *
 * It validates, in order: each entry against CatalogEntrySchema; the source register;
 * unique ids; applicability completeness (awardTypes on every entry); Florida labeling
 * (FL- ids, jurisdiction, layer, FL-* sources); sources registered, and verified entries
 * citing only verified sources; supersession chains (targets exist, are retired, end
 * before the successor starts, no cycles); tenant parameter bounds (in the schema); and,
 * against the previous release, stable ids (never removed, a retired id never returns)
 * and an increasing catalogVersion.
 *
 * Pure: no file system, no clock. The bundle carries no build time, so the same sources
 * and version always give byte-identical bundles and hashes.
 */
import { canonicalJson, sha256Hex } from './canonical.js';
import { checkEntryConventions } from './conventions.js';
import {
  CatalogEntrySchema,
  SourceRegisterSchema,
  describeProductionBundle,
  type CatalogEntry,
  type Source,
} from './schema.js';

export const CATALOG_BUNDLE_FORMAT = 1;
export const BUNDLE_CHANNELS = ['production', 'non_production'] as const;
export type BundleChannel = (typeof BUNDLE_CHANNELS)[number];

/** A compiled entry: the parsed entry (defaults applied) and the hash of its content. */
export type BundleEntry = CatalogEntry & { entryHash: string };

export type ChangeKind = 'added' | 'changed' | 'retired';
export interface ChangesetItem {
  requirementId: string;
  change: ChangeKind;
  entryHash: string;
  /** Source keys the entry cites (the PAL/PIN or source revision behind the change). */
  sourceKeys: string[];
}

export interface CatalogBundle {
  format: typeof CATALOG_BUNDLE_FORMAT;
  catalogVersion: string;
  channel: BundleChannel;
  /** SHA-256 of the canonical {channel, entries, sources}. Same content, same hash. */
  contentHash: string;
  /** SHA-256 of the canonical source register. */
  sourceRegisterHash: string;
  entries: BundleEntry[];
  sources: Source[];
  /** Differences from the previous bundle of the same channel. */
  changeset: ChangesetItem[];
  /** Entries left out of this bundle, by status (production: drafts and retired). */
  excluded: { draft: number; retired: number };
}

export interface Diagnostic {
  level: 'error' | 'warning';
  code: string;
  message: string;
  requirementId?: string;
  file?: string;
}

export interface CatalogSourceFile {
  /** Path relative to the catalog package, for messages. */
  file: string;
  data: unknown;
}

export interface CatalogSources {
  entries: readonly CatalogSourceFile[];
  /** The parsed sources/sources.yaml document ({ sources: [...] }). */
  register: unknown;
}

export interface CompileOptions {
  catalogVersion: string;
  /** The last published bundles, for stable-id checks and changesets. */
  previous?: { nonProduction?: CatalogBundle; production?: CatalogBundle };
}

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  nonProduction: CatalogBundle | null;
  production: CatalogBundle | null;
  /** Human-readable lines for the build log. */
  summary: string[];
  /** describeProductionBundle().message; null when compilation failed. */
  productionMessage: string | null;
  /** True when the production bundle has no entries (today: nothing is verified). */
  productionEmpty: boolean;
}

const SEMVER = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;

export function parseCatalogVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareCatalogVersions(a: string, b: string): number {
  const pa = parseCatalogVersion(a);
  const pb = parseCatalogVersion(b);
  if (!pa || !pb) throw new Error('compareCatalogVersions: not a catalog version');
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] as number) - (pb[i] as number);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

export function entryHash(entry: CatalogEntry): string {
  return sha256Hex(canonicalJson(entry));
}

/** Checks that need the whole catalog (the schema checks each entry alone). */
function crossChecks(
  entries: readonly { entry: CatalogEntry; file: string }[],
  sources: ReadonlyMap<string, Source>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (code: string, requirementId: string, file: string, message: string) =>
    out.push({ level: 'error', code, requirementId, file, message });
  const index = new Map(entries.map((e) => [e.entry.id, e.entry]));

  for (const { entry: e, file } of entries) {
    // Applicability completeness, Florida and best-practice labeling, cadence triggers,
    // cadenceBasis, approval backing, and tenant parameter bounds (ADR-0003 rules 5, 6,
    // 7, 11): the analyst's conventions are the one definition.
    for (const issue of checkEntryConventions(e)) {
      err('convention', e.id, file, `${issue.path}: ${issue.message}`);
    }
    // An FL- id is a Florida rule: its jurisdiction says so (the UI label depends on it).
    if (e.id.startsWith('FL-') && e.appliesTo.jurisdiction !== 'florida') {
      err('fl_label', e.id, file, 'an FL- id must set appliesTo.jurisdiction: florida');
    }

    // Sources must be registered; verified entries cite only verified sources (rule 8).
    for (const s of e.sources) {
      const registered = sources.get(s.key);
      if (!registered) {
        err('source_unregistered', e.id, file, `source ${s.key} is not in sources/sources.yaml`);
      } else if (e.status === 'verified' && registered.status !== 'verified') {
        err(
          'source_not_verified',
          e.id,
          file,
          `verified entry cites source ${s.key}, which is not verified in the register`,
        );
      }
    }

    // Supersession (rule 2).
    for (const target of e.supersedes) {
      const old = index.get(target);
      if (!old) {
        err('supersedes_unknown', e.id, file, `supersedes ${target}, which is not in the catalog`);
        continue;
      }
      if (old.status !== 'retired') {
        err('supersedes_not_retired', e.id, file, `superseded entry ${target} must be retired`);
      }
      if (old.effective.to !== null && old.effective.to >= e.effective.from) {
        err(
          'supersedes_overlap',
          e.id,
          file,
          `${target} is effective through ${old.effective.to}, overlapping ${e.id} from ${e.effective.from}`,
        );
      }
    }
  }

  // Supersession cycles.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]): boolean => {
    const s = state.get(id);
    if (s === 'done') return false;
    if (s === 'visiting') {
      out.push({
        level: 'error',
        code: 'supersedes_cycle',
        requirementId: id,
        message: `supersession cycle: ${[...path, id].join(' -> ')}`,
      });
      return true;
    }
    state.set(id, 'visiting');
    for (const next of index.get(id)?.supersedes ?? []) {
      if (index.has(next) && visit(next, [...path, id])) break;
    }
    state.set(id, 'done');
    return false;
  };
  for (const id of [...index.keys()].sort()) visit(id, []);
  return out;
}

function makeBundle(
  channel: BundleChannel,
  catalogVersion: string,
  entries: BundleEntry[],
  sources: Source[],
  sourceRegisterHash: string,
  excluded: { draft: number; retired: number },
  previous: CatalogBundle | undefined,
): CatalogBundle {
  const prev = new Map((previous?.entries ?? []).map((e) => [e.id, e]));
  const changeset: ChangesetItem[] = [];
  for (const e of entries) {
    const before = prev.get(e.id);
    const change: ChangeKind | null = !before
      ? 'added'
      : before.entryHash === e.entryHash
        ? null
        : e.status === 'retired' && before.status !== 'retired'
          ? 'retired'
          : 'changed';
    if (change) {
      changeset.push({
        requirementId: e.id,
        change,
        entryHash: e.entryHash,
        sourceKeys: [...new Set(e.sources.map((s) => s.key))].sort(),
      });
    }
  }
  // An entry that leaves the production bundle (retired there) is a retirement.
  for (const [id, before] of prev) {
    if (!entries.some((e) => e.id === id)) {
      changeset.push({
        requirementId: id,
        change: 'retired',
        entryHash: before.entryHash,
        sourceKeys: [...new Set(before.sources.map((s) => s.key))].sort(),
      });
    }
  }
  changeset.sort((a, b) => byId({ id: a.requirementId }, { id: b.requirementId }));
  const contentHash = sha256Hex(canonicalJson({ channel, entries, sources }));
  return {
    format: CATALOG_BUNDLE_FORMAT,
    catalogVersion,
    channel,
    contentHash,
    sourceRegisterHash,
    entries,
    sources,
    changeset,
    excluded,
  };
}

export function compileCatalog(input: CatalogSources, options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (): CompileResult => ({
    ok: false,
    diagnostics,
    nonProduction: null,
    production: null,
    productionMessage: null,
    productionEmpty: true,
    summary: [
      `Catalog ${options.catalogVersion}: FAILED with ${diagnostics.filter((d) => d.level === 'error').length} error(s).`,
      ...diagnostics.map(
        (d) =>
          `  ${d.level.toUpperCase()} ${d.code}${d.requirementId ? ` [${d.requirementId}]` : ''}${d.file ? ` (${d.file})` : ''}: ${d.message}`,
      ),
    ],
  });

  if (!parseCatalogVersion(options.catalogVersion)) {
    diagnostics.push({
      level: 'error',
      code: 'version_invalid',
      message: `catalogVersion ${JSON.stringify(options.catalogVersion)} is not semver (e.g. 2026.1.0)`,
    });
  }
  const previous = options.previous?.nonProduction;
  if (
    previous &&
    parseCatalogVersion(options.catalogVersion) &&
    compareCatalogVersions(options.catalogVersion, previous.catalogVersion) <= 0
  ) {
    diagnostics.push({
      level: 'error',
      code: 'version_not_increasing',
      message: `catalogVersion ${options.catalogVersion} must be greater than the last release ${previous.catalogVersion}; released versions are never edited`,
    });
  }

  const register = SourceRegisterSchema.safeParse(input.register);
  if (!register.success) {
    for (const issue of register.error.issues) {
      diagnostics.push({
        level: 'error',
        code: 'register_invalid',
        file: 'sources/sources.yaml',
        message: `${issue.path.join('.')}: ${issue.message}`,
      });
    }
  }
  const sources = register.success ? [...register.data.sources].sort(byKey) : [];
  const sourceMap = new Map(sources.map((s) => [s.key, s]));

  const parsed: { entry: CatalogEntry; file: string }[] = [];
  const seen = new Map<string, string>();
  for (const { file, data } of input.entries) {
    const r = CatalogEntrySchema.safeParse(data);
    if (!r.success) {
      const id =
        typeof data === 'object' && data !== null && 'id' in data
          ? String((data as { id: unknown }).id)
          : undefined;
      for (const issue of r.error.issues) {
        diagnostics.push({
          level: 'error',
          code: 'schema',
          file,
          ...(id ? { requirementId: id } : {}),
          message: `${issue.path.join('.') || '(entry)'}: ${issue.message}`,
        });
      }
      continue;
    }
    const e = r.data;
    const first = seen.get(e.id);
    if (first) {
      diagnostics.push({
        level: 'error',
        code: 'duplicate_id',
        requirementId: e.id,
        file,
        message: `requirementId ${e.id} is also defined in ${first}`,
      });
      continue;
    }
    seen.set(e.id, file);
    const base = file.split('/').pop() ?? file;
    if (base !== `${e.id}.yaml` && base !== `${e.id}.yml`) {
      diagnostics.push({
        level: 'warning',
        code: 'file_name',
        requirementId: e.id,
        file,
        message: `one file per requirementId: expected ${e.id}.yaml`,
      });
    }
    parsed.push({ entry: e, file });
  }

  diagnostics.push(...crossChecks(parsed, sourceMap));

  // Stable ids against the previous release (rule 2).
  if (previous) {
    const now = new Map(parsed.map((p) => [p.entry.id, p.entry]));
    for (const old of previous.entries) {
      const cur = now.get(old.id);
      if (!cur) {
        diagnostics.push({
          level: 'error',
          code: 'id_removed',
          requirementId: old.id,
          message: `${old.id} was released in ${previous.catalogVersion}; ids are never removed (retire it instead)`,
        });
      } else if (old.status === 'retired' && cur.status !== 'retired') {
        diagnostics.push({
          level: 'error',
          code: 'id_reused',
          requirementId: old.id,
          message: `${old.id} is retired; a retired id is never reused (create a new entry that supersedes it)`,
        });
      }
    }
  }

  if (diagnostics.some((d) => d.level === 'error')) return fail();

  const all: BundleEntry[] = parsed
    .map((p) => ({ ...p.entry, entryHash: entryHash(p.entry) }))
    .sort(byId);
  const sourceRegisterHash = sha256Hex(canonicalJson(sources));
  const verified = all.filter((e) => e.status === 'verified');
  const draft = all.filter((e) => e.status === 'draft').length;
  const retired = all.filter((e) => e.status === 'retired').length;

  const nonProduction = makeBundle(
    'non_production',
    options.catalogVersion,
    all,
    sources,
    sourceRegisterHash,
    { draft: 0, retired: 0 },
    previous,
  );
  // Production cites only the sources its entries use, all of which are verified.
  const usedKeys = new Set(verified.flatMap((e) => e.sources.map((s) => s.key)));
  const production = makeBundle(
    'production',
    options.catalogVersion,
    verified,
    sources.filter((s) => usedKeys.has(s.key)),
    sourceRegisterHash,
    { draft, retired },
    options.previous?.production,
  );

  const described = describeProductionBundle(parsed.map((p) => p.entry));
  const summary = [
    `Catalog ${options.catalogVersion}: ${all.length} entries (${verified.length} verified, ${draft} draft, ${retired} retired), ${sources.length} registered sources.`,
    `  non-production bundle: ${nonProduction.entries.length} entries (drafts badged), content ${nonProduction.contentHash.slice(0, 12)}.`,
    `  production bundle: ${production.entries.length} entries, content ${production.contentHash.slice(0, 12)}.`,
    `  ${described.message}`,
    ...diagnostics.map(
      (d) =>
        `  ${d.level.toUpperCase()} ${d.code}${d.requirementId ? ` [${d.requirementId}]` : ''}${d.file ? ` (${d.file})` : ''}: ${d.message}`,
    ),
  ];
  return {
    ok: true,
    diagnostics,
    nonProduction,
    production,
    summary,
    productionMessage: described.message,
    productionEmpty: production.entries.length === 0,
  };
}
