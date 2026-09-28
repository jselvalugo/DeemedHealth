/**
 * Column classes: the sensitivity class, encryption, FIPA tag, and display default of
 * every column, generated from the data dictionary (`packages/db/src/data-dictionary.ts`)
 * into `../generated/column-classes.ts`. Record types never type these by hand
 * (ADR-0014 section 1); a db test fails when the generated file is stale.
 */
import { COLUMN_CLASSES } from '../generated/column-classes.js';
import type { FieldDef, RecordTypeDef } from './define.js';

export type SensitivityClass = 'public' | 'internal' | 'confidential' | 'PII' | 'PHI';

export interface ColumnClass {
  class: SensitivityClass;
  encryption: 'field' | 'blind_index' | null;
  fipa: 'yes' | 'no' | 'to_verify';
  display: 'shown' | 'masked' | 'hidden';
  /** Free text people type; the audit diff keeps only its length and a keyed digest. */
  freeText: boolean;
}

export interface TableClasses {
  scope: 'tenant' | 'global' | 'platform';
  columns: Readonly<Record<string, ColumnClass>>;
}

export { COLUMN_CLASSES };

/** The class of a record field's column, or undefined when the column is unclassified. */
export function columnClassOf(table: string, column: string): ColumnClass | undefined {
  return COLUMN_CLASSES[table]?.columns[column];
}

export function fieldClass(def: RecordTypeDef, field: string): ColumnClass | undefined {
  const f = def.fields[field];
  return f ? columnClassOf(def.table, f.column) : undefined;
}

/**
 * Restricted fields (PHI, or displayed masked or hidden) are never listed, filtered,
 * sorted, searched, bulk-edited, exported, or imported (ADR-0014 section 1).
 */
export function isRestricted(c: ColumnClass | undefined): boolean {
  return c === undefined || c.class === 'PHI' || c.display !== 'shown';
}

/** The field is shown in lists and exports (classified, not restricted, not detail-only). */
export function isListable(def: RecordTypeDef, field: string): boolean {
  return def.fields[field]?.detailOnly !== true && !isRestricted(fieldClass(def, field));
}

/** Fields shown as `{ masked: true }` until revealed; hidden fields are never returned. */
export function isMasked(def: RecordTypeDef, field: string): boolean {
  const c = fieldClass(def, field);
  return (
    c !== undefined && (c.display === 'masked' || (c.class === 'PHI' && c.display !== 'hidden'))
  );
}

export function isHidden(def: RecordTypeDef, field: string): boolean {
  const c = fieldClass(def, field);
  return c === undefined || c.display === 'hidden';
}

export type FieldEntry = readonly [name: string, def: FieldDef];

export function fieldEntries(def: RecordTypeDef): FieldEntry[] {
  return Object.entries(def.fields);
}
