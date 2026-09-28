/**
 * Generated files in packages/domain must match their sources (ADR-0014 section 1: "CI
 * fails when stale"), and every record field's column must be classified in the data
 * dictionary the generated classes come from. Runs without a database.
 */
import { readFile } from 'node:fs/promises';
import { recordTypes } from '@deemed/domain';
import { describe, expect, it } from 'vitest';
import { GENERATED_FILES } from '../scripts/domain-sources.js';
import { DATA_DICTIONARY } from '../src/data-dictionary.js';

describe('files generated into packages/domain', () => {
  for (const f of GENERATED_FILES) {
    it(`${f.path.split('/').slice(-2).join('/')} is up to date (pnpm --filter @deemed/db generate)`, async () => {
      expect(await readFile(f.path, 'utf8')).toBe(await f.render());
    });
  }

  it('binds every record type to a tenant table whose field columns are all classified', () => {
    for (const def of recordTypes()) {
      const entry = DATA_DICTIONARY[def.table];
      expect(entry, def.table).toBeDefined();
      if (!def.readOnly) expect(entry?.scope, def.id).toBe('tenant');
      for (const [name, f] of Object.entries(def.fields)) {
        expect(entry?.columns[f.column], `${def.id}.${name} -> ${f.column}`).toBeDefined();
      }
      if (def.versioned) expect(entry?.columns.row_version, `${def.id} row_version`).toBeDefined();
      if (def.archivable) {
        for (const c of ['archived_at', 'archived_by', 'archive_reason']) {
          expect(entry?.columns[c], `${def.id} ${c}`).toBeDefined();
        }
      }
    }
  });
});
