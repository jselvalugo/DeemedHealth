/**
 * Files generated into packages/domain (ADR-0014 sections 1 and 2.9):
 *
 *  - `src/generated/column-classes.ts`: the sensitivity class, encryption, FIPA tag,
 *    display default, and free-text flag of every column, from DATA_DICTIONARY. Record
 *    types read classes from here, never by hand, so the data dictionary stays the
 *    single source.
 *  - `src/generated/record-audit-actions.ts`: audit actions derived from the record
 *    type registry that the hand-written list does not already have.
 *
 * `pnpm --filter @deemed/db generate` writes them; test/generated.test.ts fails when
 * either is stale. Output goes through Prettier with the repository config, so the
 * files pass `pnpm format:check` as generated.
 */
import { fileURLToPath } from 'node:url';
import {
  BASE_AUDIT_ACTIONS,
  recordAuditActions,
  recordTypes,
  type DerivedAuditAction,
} from '@deemed/domain';
import { format, resolveConfig } from 'prettier';
import { DATA_DICTIONARY } from '../src/data-dictionary.js';

const GENERATED_DIR = new URL('../../domain/src/generated/', import.meta.url);

const HEADER = (source: string) =>
  `// Generated from ${source} by \`pnpm --filter @deemed/db generate\`. Do not edit by hand.\n`;

const q = (s: string) => `'${s.split('\\').join('\\\\').split("'").join("\\'")}'`;

async function pretty(path: string, text: string): Promise<string> {
  const config = (await resolveConfig(path)) ?? {};
  return format(text, { ...config, filepath: path });
}

export function renderColumnClassesRaw(): string {
  const lines = [
    HEADER('packages/db/src/data-dictionary.ts'),
    "import type { TableClasses } from '../records/classes.js';",
    '',
    'export const COLUMN_CLASSES: Readonly<Record<string, TableClasses>> = {',
  ];
  for (const [table, entry] of Object.entries(DATA_DICTIONARY)) {
    lines.push(`  ${q(table)}: {`, `    scope: ${q(entry.scope)},`, '    columns: {');
    for (const [column, c] of Object.entries(entry.columns)) {
      const encryption = c.encryption ? q(c.encryption) : 'null';
      lines.push(
        `      ${column}: { class: ${q(c.class)}, encryption: ${encryption}, fipa: ${q(c.fipa ?? 'no')}, display: ${q(c.display ?? 'shown')}, freeText: ${c.freeText === true} },`,
      );
    }
    lines.push('    },', '  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}

/** Registry actions missing from the hand-written list; a category clash is an error. */
export function generatedRecordActions(): DerivedAuditAction[] {
  const base = BASE_AUDIT_ACTIONS as Record<string, { category: string }>;
  const out: DerivedAuditAction[] = [];
  for (const a of recordAuditActions(recordTypes())) {
    const existing = base[a.action];
    if (existing) {
      if (existing.category !== a.category) {
        throw new Error(`${a.action} is ${existing.category} in the base list, ${a.category} here`);
      }
      continue;
    }
    if (!out.some((o) => o.action === a.action)) out.push(a);
  }
  return out;
}

export function renderRecordAuditActionsRaw(): string {
  const lines = [
    HEADER('the record type registry (packages/domain/src/records)'),
    '/** Record-type audit actions not in BASE_AUDIT_ACTIONS (ADR-0014 section 2.9). */',
    'export const RECORD_AUDIT_ACTIONS = {',
  ];
  for (const a of generatedRecordActions()) {
    lines.push(
      `  ${q(a.action)}: { category: ${q(a.category)}, description: ${q(a.description)} },`,
    );
  }
  lines.push('} as const;', '');
  return lines.join('\n');
}

export interface GeneratedFile {
  path: string;
  render(): Promise<string>;
}

const file = (name: string, raw: () => string): GeneratedFile => {
  const path = fileURLToPath(new URL(name, GENERATED_DIR));
  return { path, render: () => pretty(path, raw()) };
};

export const GENERATED_FILES: readonly GeneratedFile[] = [
  file('column-classes.ts', renderColumnClassesRaw),
  file('record-audit-actions.ts', renderRecordAuditActionsRaw),
];
