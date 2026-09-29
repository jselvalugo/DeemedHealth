/**
 * Builds the catalog bundles (ADR-0003 rule 8).
 *
 *   pnpm --filter @deemed/requirements-catalog build:catalog -- --version 2026.1.0 \
 *     [--previous-dir <dir with the last published bundles>] [--out dist/bundles]
 *
 * Exits 1 on any compile error. Always prints whether the production bundle is empty.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BUNDLE_FILES,
  CATALOG_ROOT,
  compileCatalog,
  loadCatalogSources,
  readBundle,
  writeBundles,
} from '../src/node.js';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'previous-dir': { type: 'string' },
    out: { type: 'string', default: join(CATALOG_ROOT, 'dist', 'bundles') },
  },
});

if (!values.version) {
  console.error('build-catalog: --version <semver> is required (e.g. 2026.1.0)');
  process.exit(2);
}

const previousDir = values['previous-dir'];
const previous: Parameters<typeof compileCatalog>[1]['previous'] = {};
if (previousDir) {
  const np = join(previousDir, BUNDLE_FILES.non_production);
  const p = join(previousDir, BUNDLE_FILES.production);
  if (existsSync(np)) previous.nonProduction = await readBundle(np);
  if (existsSync(p)) previous.production = await readBundle(p);
}

const result = compileCatalog(await loadCatalogSources(), {
  catalogVersion: values.version,
  previous,
});
for (const line of result.summary) console.log(line);
if (!result.ok) process.exit(1);
for (const path of await writeBundles(values.out as string, result)) console.log(`wrote ${path}`);
