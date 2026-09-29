#!/usr/bin/env node
// Fails when a migration weakens the catalog guards (security review S9): any statement on a
// catalog.* object that disables or drops a trigger or drops a constraint. Released
// catalog versions are immutable, and production accepts verified entries only; those
// rules live in triggers and constraints that no later migration may switch off.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const WEAKENING = [/\bDISABLE\s+TRIGGER\b/i, /\bDROP\s+TRIGGER\b/i, /\bDROP\s+CONSTRAINT\b/i];
// The statement's target is a catalog table (ALTER TABLE catalog.x ..., DROP TRIGGER t ON catalog.x).
const CATALOG_OBJECT =
  /\b(?:ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?|\bON\s+)catalog\.[a-z_]/i;

/** SQL without line comments and string literals, split into statements. */
function statements(sql) {
  const code = sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
  return code.split(';');
}

/** Violations in one migration's text: [{ file, statement }], never the whole SQL. */
export function findCatalogGuardViolations(sql, file) {
  const out = [];
  statements(sql).forEach((stmt, i) => {
    if (CATALOG_OBJECT.test(stmt) && WEAKENING.some((re) => re.test(stmt))) {
      out.push({ file, statement: i + 1 });
    }
  });
  return out;
}

const MIGRATIONS = fileURLToPath(new URL('../packages/db/migrations/', import.meta.url));

export function checkMigrationsDir(dir = MIGRATIONS) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((f) => findCatalogGuardViolations(readFileSync(join(dir, f), 'utf8'), f));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = checkMigrationsDir();
  for (const v of found) {
    console.error(`${v.file}: statement ${v.statement} disables or drops a catalog guard`);
  }
  if (found.length) process.exit(1);
  console.log('check-catalog-migrations: no migration weakens the catalog guards.');
}
