/**
 * Import dry run (ADR-0014 section 2.8). Upload CSV; the dry run maps headers by the
 * type's EN/ES aliases, runs the SSN column guard and SSN-shaped value rejection (D1),
 * parses each row with the Zod schema and the record rules, resolves natural keys within
 * the viewer's scope to create or update, checks each row against the policy, and
 * returns a row-level report. NOTHING is written, and no cell value is echoed back.
 *
 * Commit (with the dry-run id and the same file SHA-256, one transaction, 5,000 rows)
 * and XLSX arrive after this slice. The whole feature sits behind the `records.import`
 * flag, off in every deployed environment until G4 (flags.ts), so real data cannot be
 * loaded (D9); CI runs it on synthetic fixtures only.
 */
import { createHash } from 'node:crypto';
import {
  IMPORT_MAX_ROWS,
  ImportDryRunRequest,
  createSchema,
  detectSsnLikeColumns,
  importFields,
  isSsnShapedValue,
  normalizeHeader,
  parseCsv,
  permissionScope,
  ruleProblems,
  updateFields,
  type FieldDef,
  type ImportDryRunReport,
  type RecordTypeDef,
} from '@deemed/domain';
import { sql } from 'drizzle-orm';
import { ApiError } from '../errors.js';
import { flagEnabled } from '../flags.js';
import type { RecordCall } from './http.js';
import {
  archivedSql,
  binding,
  col,
  fieldValues,
  scopePredicate,
  selectRows,
  typed,
} from './rows.js';
import { decideRecord, newResource, resourceOf } from './scope.js';

type Report = ImportDryRunReport;
type RowReport = Report['rows'][number];
type ColumnReport = Report['columns'][number];

/** Normalized header (field name or an EN/ES alias) to field. */
function aliasMap(def: RecordTypeDef): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of importFields(def)) {
    map.set(normalizeHeader(name), name);
    for (const alias of def.import.headers[name] ?? []) map.set(normalizeHeader(alias), name);
  }
  return map;
}

function cellValue(f: FieldDef, cell: string): unknown {
  const text = cell.trim();
  if (text === '') return f.nullable ? null : undefined;
  if (f.kind === 'boolean') return text === 'true' ? true : text === 'false' ? false : text;
  if (f.kind === 'integer') return Number.isSafeInteger(Number(text)) ? Number(text) : text;
  return text;
}

function errorsFrom(def: RecordTypeDef, paths: readonly string[], code = 'invalid') {
  const required = new Set<string>(def.rules?.required ?? []);
  return paths.map((p) => ({
    field: p,
    code: required.has(p) && code === 'invalid' ? 'required_or_invalid' : code,
  }));
}

export async function importDryRun(c: RecordCall): Promise<Report> {
  const { h, def } = c;
  if (!def.import.enabled || !flagEnabled('records.import', h.services.dhEnv)) {
    throw new ApiError('unsupported');
  }
  const { csv } = h.body(ImportDryRunRequest);
  const report: Report = {
    recordType: def.id,
    dryRun: true,
    fileSha256: createHash('sha256').update(csv, 'utf8').digest('hex'),
    refused: null,
    columns: [],
    summary: { create: 0, update: 0, error: 0 },
    rows: [],
  };
  const refuse = (why: NonNullable<Report['refused']>): Report => ({ ...report, refused: why });

  const parsed = parseCsv(csv, {
    maxRows: IMPORT_MAX_ROWS + 1,
    maxColumns: 100,
    maxCellLength: 2000,
  });
  if (!parsed.ok) return refuse(parsed.error === 'too_many_rows' ? 'too_many_rows' : 'bad_csv');
  const [header, ...rows] = parsed.rows;
  if (!header || rows.length === 0) return refuse('no_rows');
  if (rows.length > IMPORT_MAX_ROWS) return refuse('too_many_rows');

  // Map headers, then the D1 guard on every column (name and sampled values).
  const aliases = aliasMap(def);
  const taken = new Set<string>();
  const columns: ColumnReport[] = header.map((name, i) => {
    const sample = rows.slice(0, 50).map((r) => r[i] ?? '');
    const finding = detectSsnLikeColumns([{ name, values: sample }])[0];
    if (finding?.confidence === 'high') return { header: name, field: null, status: 'blocked_ssn' };
    if (finding) return { header: name, field: null, status: 'confirm_not_ssn' };
    const field = aliases.get(normalizeHeader(name));
    if (!field || taken.has(field)) return { header: name, field: null, status: 'ignored' };
    taken.add(field);
    return { header: name, field, status: 'mapped' };
  });
  report.columns = columns;
  if (columns.some((c) => c.status === 'blocked_ssn')) return refuse('ssn_column');
  if (!columns.some((c) => c.status === 'mapped')) return refuse('no_mapped_columns');

  const updatable = new Set(updateFields(def));
  const create = createSchema(def);
  const seenKeys = new Set<string>();

  await h.tenant(async (tx) => {
    const p = h.principal();
    const scope = scopePredicate(def, permissionScope(p, def.access.read, h.now()), p.personId);
    for (const [index, cells] of rows.entries()) {
      const out: RowReport = { row: index + 1, action: 'error', errors: [] };
      report.rows.push(out);

      // D1: an SSN-shaped value anywhere in the row fails it; the value is never echoed.
      cells.forEach((cell, j) => {
        if (isSsnShapedValue(cell)) {
          out.errors.push({ field: columns[j]?.field ?? `column ${j + 1}`, code: 'ssn_value' });
        }
      });
      if (out.errors.length > 0) continue;

      const values: Record<string, unknown> = {};
      columns.forEach((col, j) => {
        if (col.status !== 'mapped' || !col.field) return;
        const v = cellValue(def.fields[col.field] as FieldDef, cells[j] ?? '');
        if (v !== undefined) values[col.field] = v;
      });

      const key = def.import.naturalKey.map((k) => values[k]);
      const complete = key.length > 0 && key.every((v) => typeof v === 'string' && v !== '');
      if (complete) {
        const text = JSON.stringify(key);
        if (seenKeys.has(text)) {
          out.errors.push({ field: def.import.naturalKey.join('+'), code: 'duplicate_in_file' });
          continue;
        }
        seenKeys.add(text);
      }
      // Only rows the viewer may see can be matched (and so updated).
      const existing = complete
        ? (
            await selectRows(tx, def, {
              where: [
                scope,
                archivedSql(def, 'exclude'),
                ...def.import.naturalKey.map((k) => {
                  const f = def.fields[k] as FieldDef;
                  return sql`${col(f.column)} = ${typed(f.kind, values[k])}`;
                }),
              ],
              limit: 1,
            })
          )[0]
        : undefined;

      if (existing) {
        const changes = Object.fromEntries(
          Object.entries(values).filter(([k]) => updatable.has(k)),
        );
        const merged = { ...fieldValues(def, existing), ...changes };
        const bad = [
          ...ruleProblems(def, merged),
          ...((await binding(def).validate?.(tx, merged)) ?? []),
        ];
        out.errors.push(...errorsFrom(def, bad));
        if (!decideRecord(h, def.access.update, resourceOf(existing), 'all').allowed) {
          out.errors.push({ field: '(row)', code: 'forbidden' });
        }
        if (out.errors.length === 0) {
          out.action = 'update';
          out.id = existing.__id;
        }
        continue;
      }

      const result = create.safeParse(values);
      if (!result.success) {
        out.errors.push(
          ...errorsFrom(def, [
            ...new Set(result.error.issues.map((i) => i.path.join('.') || '(row)')),
          ]),
        );
        continue;
      }
      const bad = (await binding(def).validate?.(tx, result.data as Record<string, unknown>)) ?? [];
      out.errors.push(...errorsFrom(def, bad));
      if (!decideRecord(h, def.access.create, newResource(def, values), 'all').allowed) {
        out.errors.push({ field: '(row)', code: 'forbidden' });
      }
      if (out.errors.length === 0) out.action = 'create';
    }
  });

  for (const r of report.rows) report.summary[r.action]++;
  return report;
}
