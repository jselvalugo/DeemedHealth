import { describe, expect, it } from 'vitest';
import { csvCell, normalizeHeader, parseCsv, toCsv } from './csv.js';

describe('CSV', () => {
  it('parses quoted fields, doubled quotes, CRLF and LF, and a BOM', () => {
    const text = '﻿name,city\r\n"Main, ""North""",Tampa\nSecond,"Line\nbreak"\n';
    expect(parseCsv(text)).toEqual({
      ok: true,
      rows: [
        ['name', 'city'],
        ['Main, "North"', 'Tampa'],
        ['Second', 'Line\nbreak'],
      ],
    });
  });

  it('keeps empty cells and skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,\n')).toEqual({
      ok: true,
      rows: [
        ['a', 'b'],
        ['1', ''],
      ],
    });
  });

  it('refuses malformed quoting and enforces limits while reading', () => {
    expect(parseCsv('"open')).toEqual({ ok: false, error: 'unterminated_quote' });
    expect(parseCsv('a"b')).toEqual({ ok: false, error: 'bad_quote' });
    expect(parseCsv('"a"b')).toEqual({ ok: false, error: 'bad_quote' });
    const limits = { maxRows: 2, maxColumns: 2, maxCellLength: 5 };
    expect(parseCsv('a\nb\nc\nd', limits)).toEqual({ ok: false, error: 'too_many_rows' });
    expect(parseCsv('a,b,c', limits)).toEqual({ ok: false, error: 'too_many_columns' });
    expect(parseCsv('abcdefgh', limits)).toEqual({ ok: false, error: 'cell_too_long' });
  });

  it('stays linear on hostile input', () => {
    const hostile = '"'.repeat(200_001);
    const started = performance.now();
    parseCsv(hostile);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('neutralizes formulas and doubles every quote when writing', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const lead of ['+', '-', '@', '\t', '\r']) expect(csvCell(`${lead}1`)).toBe(`"'${lead}1"`);
    expect(csvCell('a"b"c')).toBe('"a""b""c"');
    expect(csvCell(null)).toBe('""');
    expect(
      toCsv([
        ['a', 1],
        [true, null],
      ]),
    ).toBe('"a","1"\r\n"true",""\r\n');
  });

  it('round-trips what it writes', () => {
    const rows = [
      ['name', 'note'],
      ['A, "B"', 'multi\nline'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual({ ok: true, rows });
  });

  it('normalizes headers for alias matching', () => {
    expect(normalizeHeader('  Form 5B  site_ID ')).toBe('form 5b site id');
    expect(normalizeHeader('Código postal')).toBe('código postal');
  });
});
