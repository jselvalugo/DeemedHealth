/**
 * CSV for record export and import (ADR-0014 sections 2.7 and 2.8).
 *
 *  - `parseCsv`: RFC 4180 (quoted fields, doubled quotes, CRLF or LF), one pass with a
 *    character loop, so hostile input cannot trigger regex backtracking. Limits on rows,
 *    columns, and cell length are enforced while reading.
 *  - `csvCell` / `toCsv`: every cell is quoted, quotes are doubled (all of them), and a
 *    cell that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, carriage
 *    return) is prefixed with a single quote (formula-injection guard).
 */

export interface CsvLimits {
  maxRows: number;
  maxColumns: number;
  maxCellLength: number;
}

export const CSV_LIMITS: CsvLimits = { maxRows: 5001, maxColumns: 100, maxCellLength: 2000 };

export type CsvResult =
  | { ok: true; rows: string[][] }
  | {
      ok: false;
      error:
        'unterminated_quote' | 'too_many_rows' | 'too_many_columns' | 'cell_too_long' | 'bad_quote';
    };

export function parseCsv(text: string, limits: CsvLimits = CSV_LIMITS): CsvResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let i = 0;
  // A UTF-8 byte-order mark is not part of the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endCell = (): CsvResult | null => {
    if (cell.length > limits.maxCellLength) return { ok: false, error: 'cell_too_long' };
    row.push(cell);
    cell = '';
    wasQuoted = false;
    if (row.length > limits.maxColumns) return { ok: false, error: 'too_many_columns' };
    return null;
  };
  const endRow = (): CsvResult | null => {
    const failed = endCell();
    if (failed) return failed;
    // Skip blank lines (a single empty unquoted cell).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    if (rows.length > limits.maxRows) return { ok: false, error: 'too_many_rows' };
    return null;
  };

  for (; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        cell += ch;
        if (cell.length > limits.maxCellLength) return { ok: false, error: 'cell_too_long' };
      }
      continue;
    }
    if (ch === '"') {
      if (cell.length > 0 || wasQuoted) return { ok: false, error: 'bad_quote' };
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') {
      const failed = endCell();
      if (failed) return failed;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      const failed = endRow();
      if (failed) return failed;
    } else {
      if (wasQuoted) return { ok: false, error: 'bad_quote' };
      cell += ch;
      if (cell.length > limits.maxCellLength) return { ok: false, error: 'cell_too_long' };
    }
  }
  if (quoted) return { ok: false, error: 'unterminated_quote' };
  if (cell.length > 0 || row.length > 0 || wasQuoted) {
    const failed = endRow();
    if (failed) return failed;
  }
  return { ok: true, rows };
}

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

/** A cell a spreadsheet would evaluate gets a leading single quote. */
export function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_START.has(value[0] as string) ? `'${value}` : value;
}

/** One quoted CSV cell. Every double quote is doubled (split/join, not a single replace). */
export function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${neutralizeFormula(text).split('"').join('""')}"`;
}

export function toCsv(
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Header normalization for import alias matching: trim, lower case, single spaces. */
export function normalizeHeader(value: string): string {
  let out = '';
  let space = false;
  for (const ch of value.trim().toLowerCase()) {
    const isSpace = ch === ' ' || ch === '\t' || ch === '_' || ch === '-';
    if (isSpace) {
      space = out.length > 0;
      continue;
    }
    if (space) out += ' ';
    space = false;
    out += ch;
  }
  return out;
}
