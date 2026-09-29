/**
 * Reads the catalog's Git source of truth from disk (ADR-0003 rule 1): one YAML document
 * per requirementId in entries/, and the source register in sources/sources.yaml.
 * A missing entries/ directory reads as an empty catalog.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { CatalogBundle, CatalogSources, CompileResult } from './compiler.js';

/** The package root (entries/ and sources/ live here). */
export const CATALOG_ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function loadCatalogSources(root: string = CATALOG_ROOT): Promise<CatalogSources> {
  const entriesDir = join(root, 'entries');
  let names: string[] = [];
  try {
    names = (await readdir(entriesDir)).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  names.sort();
  const entries = await Promise.all(
    names.map(async (name) => ({
      file: `entries/${name}`,
      data: parseYaml(await readFile(join(entriesDir, name), 'utf8')) as unknown,
    })),
  );
  const register = parseYaml(await readFile(join(root, 'sources', 'sources.yaml'), 'utf8'));
  return { entries, register };
}

export const BUNDLE_FILES = {
  non_production: 'catalog.non-production.json',
  production: 'catalog.production.json',
} as const;

/** Writes both bundles as JSON (stable key order is already in the bundle). */
export async function writeBundles(outDir: string, result: CompileResult): Promise<string[]> {
  if (!result.ok || !result.nonProduction || !result.production) {
    throw new Error('writeBundles: compilation failed; nothing written');
  }
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const bundle of [result.nonProduction, result.production]) {
    const path = join(outDir, BUNDLE_FILES[bundle.channel]);
    await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    written.push(path);
  }
  return written;
}

export async function readBundle(path: string): Promise<CatalogBundle> {
  return JSON.parse(await readFile(path, 'utf8')) as CatalogBundle;
}
