/**
 * Writes the files generated into packages/domain (see domain-sources.ts):
 *   pnpm --filter @deemed/db generate
 * Run it after changing the data dictionary or the record type registry, then add the
 * new record audit actions to a migration (test/registry-sync.test.ts checks them).
 */
import { writeFile } from 'node:fs/promises';
import { GENERATED_FILES, generatedRecordActions } from './domain-sources.js';

for (const f of GENERATED_FILES) {
  await writeFile(f.path, await f.render());
  console.log(`wrote ${f.path}`);
}
console.log(`record audit actions generated: ${generatedRecordActions().length}`);
