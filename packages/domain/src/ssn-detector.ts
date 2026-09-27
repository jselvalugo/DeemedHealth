/**
 * SSN-like column detector (roadmap decision D1: Deemed Health never collects SSNs).
 *
 * Used by:
 *  - the CSV/XLSX importer (G1): run on the header row and sample cell values before a
 *    dry run; a `high` finding blocks the column, a `possible` finding needs the user to
 *    confirm the column is not an SSN before it can be mapped;
 *  - the schema tests in @deemed/db: no database column may look like an SSN column.
 *
 * Findings never include the matched values themselves (log hygiene), only counts.
 */

export type SsnConfidence = 'high' | 'possible';

export interface SsnColumnFinding {
  column: string;
  confidence: SsnConfidence;
  reason: 'column_name' | 'value_pattern';
  /** Plain-language explanation, safe to log (never contains cell values). */
  detail: string;
}

export interface ColumnSample {
  name: string;
  /** Optional sample of cell values (for an import, the first N non-empty rows). */
  values?: readonly unknown[];
}

/** Formatted SSN shape: ddd-dd-dddd or ddd dd dddd. */
const SSN_FORMATTED = /^\s*\d{3}[- ]\d{2}[- ]\d{4}\s*$/;
/** Bare nine digits (also ZIP+4 without a dash, EINs, routing numbers): weak signal only. */
const NINE_DIGITS = /^\s*\d{9}\s*$/;

/** Tokens that on their own name an SSN-like identifier (EN and ES headers). */
const HIGH_TOKENS = new Set(['ssn', 'ssns', 'ssan', 'ssno', 'ssnum', 'ssnumber', 'socsec', 'nss']);
/** Adjacent token pairs that name one. */
const HIGH_PAIRS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['social', new Set(['security', 'sec'])],
  ['soc', new Set(['sec', 'security'])],
  ['seguro', new Set(['social'])],
  ['ss', new Set(['no', 'num', 'nbr', 'number', 'numero', 'id', 'card'])],
];
/** Tax identifiers can be SSNs for individuals; ask before mapping. */
const POSSIBLE_TOKENS = new Set(['tin', 'itin', 'taxpayer']);
const POSSIBLE_PAIRS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['tax', new Set(['id', 'no', 'num', 'number'])],
];

/**
 * Splits a header into lowercase tokens: separators, camelCase, and letter/digit
 * boundaries; "#" reads as "number"; runs of single letters are joined, so "S.S.N."
 * becomes "ssn".
 */
export function tokenizeColumnName(name: string): string[] {
  const raw = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/#/g, ' number ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out: string[] = [];
  let letters = '';
  for (const token of raw) {
    if (token.length === 1 && /[a-z]/.test(token)) {
      letters += token;
      continue;
    }
    if (letters) out.push(letters);
    letters = '';
    out.push(token);
  }
  if (letters) out.push(letters);
  return out;
}

function matchesPairs(
  tokens: readonly string[],
  pairs: ReadonlyArray<readonly [string, ReadonlySet<string>]>,
): boolean {
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i] as string;
    const b = tokens[i + 1] as string;
    if (pairs.some(([first, seconds]) => first === a && seconds.has(b))) return true;
  }
  return false;
}

/** Classifies a column name; null when it does not look like an SSN column. */
export function classifySsnColumnName(name: string): SsnConfidence | null {
  const tokens = tokenizeColumnName(name);
  const joined = tokens.join('');
  if (
    tokens.some((t) => HIGH_TOKENS.has(t)) ||
    matchesPairs(tokens, HIGH_PAIRS) ||
    joined.includes('socialsecurity') ||
    joined.includes('segurosocial')
  ) {
    return 'high';
  }
  if (tokens.some((t) => POSSIBLE_TOKENS.has(t)) || matchesPairs(tokens, POSSIBLE_PAIRS)) {
    return 'possible';
  }
  return null;
}

/** True when a single value has the formatted SSN shape. */
export function isSsnShapedValue(value: unknown): boolean {
  return typeof value === 'string' && SSN_FORMATTED.test(value);
}

/** Share of non-empty sample values that are bare nine-digit strings or numbers. */
function nineDigitShare(values: readonly unknown[]): { share: number; nonEmpty: number } {
  let nonEmpty = 0;
  let nine = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const text = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : null;
    if (text === null || text.trim() === '') continue;
    nonEmpty += 1;
    if (NINE_DIGITS.test(text)) nine += 1;
  }
  return { share: nonEmpty ? nine / nonEmpty : 0, nonEmpty };
}

/**
 * Detects SSN-like columns from names and (optionally) sample values.
 * Returns at most one finding per column, the strongest one.
 */
export function detectSsnLikeColumns(columns: readonly ColumnSample[]): SsnColumnFinding[] {
  const findings: SsnColumnFinding[] = [];
  for (const column of columns) {
    const byName = classifySsnColumnName(column.name);
    const values = column.values ?? [];
    const formatted = values.filter(isSsnShapedValue).length;

    if (formatted > 0) {
      findings.push({
        column: column.name,
        confidence: 'high',
        reason: 'value_pattern',
        detail: `${formatted} value(s) have the SSN shape ddd-dd-dddd`,
      });
      continue;
    }
    if (byName) {
      findings.push({
        column: column.name,
        confidence: byName,
        reason: 'column_name',
        detail:
          byName === 'high'
            ? 'column name refers to a Social Security number'
            : 'column name refers to a tax identifier, which can be an SSN',
      });
      continue;
    }
    const { share, nonEmpty } = nineDigitShare(values);
    if (nonEmpty >= 3 && share >= 0.8) {
      findings.push({
        column: column.name,
        confidence: 'possible',
        reason: 'value_pattern',
        detail: `${Math.round(share * 100)}% of sampled values are bare nine-digit numbers`,
      });
    }
  }
  return findings;
}
