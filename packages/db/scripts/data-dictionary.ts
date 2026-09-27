/**
 * CLI: pnpm --filter @deemed/db dictionary
 * Regenerates docs/data/data-dictionary.md from src/data-dictionary.ts.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderDataDictionaryMarkdown } from '../src/data-dictionary.js';

export const DICTIONARY_DOC = fileURLToPath(
  new URL('../../../docs/data/data-dictionary.md', import.meta.url),
);

await writeFile(DICTIONARY_DOC, renderDataDictionaryMarkdown(), 'utf8');
console.log(`wrote ${DICTIONARY_DOC}`);
