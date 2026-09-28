/**
 * Form values ↔ API payloads for `RecordForm`, and validation messages in EN and ES.
 * The form parses with the same schemas the API re-parses with (`createSchema`,
 * `updateSchema`, and the record rules from @deemed/domain), so a message shown here is
 * the message the server would cause, just earlier.
 */
import {
  createFields,
  createSchema,
  ruleProblems,
  updateFields,
  updateSchema,
  type FieldDef,
  type FieldValue,
  type RecordTypeDef,
} from '@deemed/domain';
import { isMessageKey, t, type Locale } from '@deemed/i18n';
import { fieldLabel } from './format.js';

export type FormMode = 'create' | 'edit';
/** Raw input state: text inputs and selects hold strings, checkboxes booleans. */
export type FormValues = Record<string, string | boolean>;

export function formFields(def: RecordTypeDef, mode: FormMode): string[] {
  return mode === 'create' ? createFields(def) : updateFields(def);
}

export function isRequired(def: RecordTypeDef, field: string): boolean {
  return (def.rules?.required as readonly string[] | undefined)?.includes(field) ?? false;
}

/** A record's current values as form input values. */
export function toFormValues(
  def: RecordTypeDef,
  fields: readonly string[],
  record: Readonly<Record<string, FieldValue | undefined>> | undefined,
): FormValues {
  const out: FormValues = {};
  for (const name of fields) {
    const f = def.fields[name] as FieldDef;
    const v = record?.[name];
    if (f.kind === 'boolean') out[name] = v === true;
    else if (typeof v === 'string') out[name] = v;
    else if (typeof v === 'number') out[name] = String(v);
    else out[name] = '';
  }
  return out;
}

/** One input value as the API expects it; `undefined` means "leave out". */
function toPayloadValue(f: FieldDef, raw: string | boolean | undefined): unknown {
  if (f.kind === 'boolean') return raw === true;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return f.nullable ? null : undefined;
  if (f.kind === 'integer') {
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : text;
  }
  return text;
}

/**
 * The payload for a create (every filled field) or an update (only fields that differ
 * from the record the user started from).
 */
export function toPayload(
  def: RecordTypeDef,
  mode: FormMode,
  values: FormValues,
  baseline: FormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of formFields(def, mode)) {
    const f = def.fields[name] as FieldDef;
    if (mode === 'edit' && values[name] === baseline[name]) continue;
    const v = toPayloadValue(f, values[name]);
    if (v === undefined) {
      // Clearing a required field on edit is sent as an empty string so it fails validation.
      if (mode === 'edit') out[name] = '';
      continue;
    }
    out[name] = v;
  }
  return out;
}

/** The parts of a Zod issue the messages use (zod is a dependency of @deemed/domain). */
type Issue = {
  code: string;
  path: readonly (string | number)[];
  maximum?: unknown;
  validation?: unknown;
};

type Problem = { field: string; key: 'required' | 'choose' | 'tooLong' | 'email' | 'date' | 'id' | 'invalid' | 'rule'; max?: number };

function problemOf(def: RecordTypeDef, issue: Issue, value: unknown): Problem | null {
  const field = String(issue.path[0] ?? '');
  const f = def.fields[field];
  if (!f) return null;
  const empty = value === undefined || value === null || value === '';
  const choose = f.kind === 'enum' || f.kind === 'uuid' || f.kind === 'boolean';
  if (empty) return { field, key: choose ? 'choose' : 'required' };
  switch (issue.code) {
    case 'too_big':
      return { field, key: 'tooLong', max: Number(issue.maximum) };
    case 'too_small':
      return { field, key: 'required' };
    case 'invalid_enum_value':
      return { field, key: 'choose' };
    case 'invalid_string':
      if (issue.validation === 'email') return { field, key: 'email' };
      if (issue.validation === 'uuid') return { field, key: 'id' };
      return { field, key: f.kind === 'date' ? 'date' : 'invalid' };
    case 'custom':
      return { field, key: 'rule' };
    default:
      return { field, key: f.kind === 'date' ? 'date' : 'invalid' };
  }
}

function message(locale: Locale, def: RecordTypeDef, p: Problem): string {
  const label = fieldLabel(locale, def, p.field);
  if (p.key === 'rule') {
    const specific = `records.rule.${def.id}.${p.field}`;
    return isMessageKey(specific)
      ? t(locale, specific)
      : t(locale, 'records.validation.invalid', { field: label });
  }
  const key = `records.validation.${p.key}` as const;
  return t(locale, key, { field: label, max: p.max ?? 0 });
}

export type FieldErrors = Record<string, string>;

/**
 * Validates a create payload, or an update payload merged over the current record (the
 * record rules need the whole record). Returns messages keyed by field, in form order.
 */
export function validatePayload(
  locale: Locale,
  def: RecordTypeDef,
  mode: FormMode,
  payload: Record<string, unknown>,
  current: Readonly<Record<string, unknown>> = {},
): FieldErrors {
  const problems: Problem[] = [];
  const schema = mode === 'create' ? createSchema(def) : updateSchema(def);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const p = problemOf(def, issue as Issue, payload[String(issue.path[0] ?? '')]);
      if (p) problems.push(p);
    }
  }
  {
    // Rules run on the merged record (a create has no current values). Zod skips its own
    // refinements when a field fails, so they are checked here as well.
    const merged = mode === 'edit' ? { ...current, ...payload } : payload;
    for (const field of ruleProblems(def, merged)) {
      const v = merged[field];
      const empty = v === undefined || v === null || v === '';
      const kind = def.fields[field]?.kind;
      problems.push({
        field,
        key: empty ? (kind === 'enum' || kind === 'uuid' ? 'choose' : 'required') : 'rule',
      });
    }
  }
  return toErrors(locale, def, mode, problems);
}

/** Server `bad_request` field paths as messages (the value that caused it stays local). */
export function serverErrors(
  locale: Locale,
  def: RecordTypeDef,
  mode: FormMode,
  paths: readonly string[],
  payload: Record<string, unknown>,
  current: Readonly<Record<string, unknown>> = {},
): FieldErrors {
  const problems: Problem[] = [];
  for (const path of paths) {
    const field = path.split('.')[0] ?? '';
    if (!def.fields[field]) continue;
    const v = field in payload ? payload[field] : current[field];
    const empty = v === undefined || v === null || v === '';
    problems.push({ field, key: empty ? 'required' : 'rule' });
  }
  return toErrors(locale, def, mode, problems);
}

function toErrors(
  locale: Locale,
  def: RecordTypeDef,
  mode: FormMode,
  problems: Problem[],
): FieldErrors {
  const order = formFields(def, mode);
  const out: FieldErrors = {};
  for (const name of order) {
    const p = problems.find((x) => x.field === name);
    if (p) out[name] = message(locale, def, p);
  }
  return out;
}
