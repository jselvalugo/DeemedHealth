/**
 * Create, update, and bulk payload schemas derived from a record type's Zod schema
 * (`.pick` of the editable fields), plus the record rules (required fields and the
 * type's cross-field refine). The server re-parses every payload with these.
 */
import { z, type ZodTypeAny } from 'zod';
import type { RecordTypeDef } from './define.js';

type Mask = Record<string, true>;

function mask(names: readonly string[]): Mask {
  return Object.fromEntries(names.map((n) => [n, true as const]));
}

export function createFields(def: RecordTypeDef): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => f.editable === 'create' || f.editable === 'always')
    .map(([n]) => n);
}

export function updateFields(def: RecordTypeDef): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => f.editable === 'always')
    .map(([n]) => n);
}

export function bulkFields(def: RecordTypeDef): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => f.bulkEditable)
    .map(([n]) => n);
}

export function importFields(def: RecordTypeDef): string[] {
  return Object.entries(def.fields)
    .filter(([, f]) => f.importable)
    .map(([n]) => n);
}

function picked(def: RecordTypeDef, names: readonly string[]) {
  // The registry test guarantees every editable field is a key of the schema.
  return def.schema
    .pick(mask(names) as never)
    .partial()
    .strict();
}

/**
 * Paths of rule violations on a merged record (current values plus the change): required
 * fields present and not null, then the type's refine.
 */
export function ruleProblems(
  def: RecordTypeDef,
  record: Readonly<Record<string, unknown>>,
): string[] {
  const bad: string[] = [];
  for (const r of def.rules?.required ?? []) {
    const v = record[r];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) bad.push(r);
  }
  for (const path of def.rules?.refine?.(record) ?? []) if (!bad.includes(path)) bad.push(path);
  return bad;
}

function withRules(schema: ZodTypeAny, def: RecordTypeDef, base?: Record<string, unknown>) {
  return schema.superRefine((value: Record<string, unknown>, ctx) => {
    for (const path of ruleProblems(def, { ...base, ...value })) {
      ctx.addIssue({ code: 'custom', path: [path], message: 'rule' });
    }
  });
}

/** Payload of `POST /api/records/<type>`: editable fields, rules applied. */
export function createSchema(def: RecordTypeDef) {
  return withRules(picked(def, createFields(def)), def);
}

/**
 * Payload of `PATCH /api/records/<type>/<id>`: fields editable after create, at least one.
 * Rules run later on the merged record (they need the current values).
 */
export function updateSchema(def: RecordTypeDef) {
  return picked(def, updateFields(def)).refine((v) => Object.keys(v).length > 0, {
    message: 'nothing to change',
  });
}

/** `fields` of a bulk update: bulk-editable fields only, at least one. */
export function bulkUpdateSchema(def: RecordTypeDef) {
  return picked(def, bulkFields(def)).refine((v) => Object.keys(v).length > 0, {
    message: 'nothing to change',
  });
}

/** Zod issues to field paths (never values). */
export function issuePaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.path.join('.') || '(body)'))];
}
