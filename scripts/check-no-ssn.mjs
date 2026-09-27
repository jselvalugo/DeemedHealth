#!/usr/bin/env node
// Fails when an SSN-shaped value (ddd-dd-dddd) appears in tracked source, fixtures,
// or seed files. Roadmap decision D1: Deemed Health never collects SSNs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SSN = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;
// Files allowed to contain the pattern. Keep this list short and reviewed.
const ALLOWLIST = new Set(['scripts/check-no-ssn.mjs', 'pnpm-lock.yaml']);
const SKIP_EXT = /\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|zip|gz)$/i;

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter((f) => f && !ALLOWLIST.has(f) && !SKIP_EXT.test(f));

let hits = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (line.match(SSN)) {
      hits++;
      // Print location only, never the value itself.
      console.error(`${file}:${i + 1}: SSN-shaped value found`);
    }
  });
}
if (hits) {
  console.error(`\n${hits} SSN-shaped value(s) found. Remove them (decision D1).`);
  process.exit(1);
}
console.log(`check-no-ssn: ${files.length} files clean.`);
