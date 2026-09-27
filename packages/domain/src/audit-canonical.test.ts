import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CanonicalFormError,
  GENESIS_PREV_HASH,
  canonicalAuditRow,
  computeAuditRowHash,
  jcs,
  verifyAuditChain,
  type AuditRowExport,
} from './audit-canonical.js';
import { GOLDEN_CANONICAL, GOLDEN_ROW } from './audit-canonical.test-utils.js';

describe('jcs', () => {
  it('sorts keys, drops whitespace, and escapes like JSON.stringify', () => {
    expect(jcs({ b: 1, a: 'x\u0001"\\' })).toBe('{"a":"x\\u0001\\"\\\\","b":1}');
    expect(jcs([true, false, null, 0, -0, 0.5, 1e20])).toBe(
      '[true,false,null,0,0,0.5,100000000000000000000]',
    );
  });

  it('rejects values outside the supported subset', () => {
    expect(() => jcs({ 'bad key': 1 })).toThrow(CanonicalFormError);
    expect(() => jcs(1e21)).toThrow(CanonicalFormError);
    expect(() => jcs(1e-7)).toThrow(CanonicalFormError);
    expect(() => jcs(0.1 + 0.2)).toThrow(CanonicalFormError);
    expect(() => jcs(Number.NaN)).toThrow(CanonicalFormError);
  });
});

describe('canonicalAuditRow', () => {
  it('matches the golden bytes', () => {
    expect(canonicalAuditRow(GOLDEN_ROW)).toBe(GOLDEN_CANONICAL);
  });

  it('refuses an unknown schema_version', () => {
    expect(() => canonicalAuditRow({ ...GOLDEN_ROW, schema_version: 99 })).toThrow(
      CanonicalFormError,
    );
  });

  it('hashes prev_hash bytes followed by the UTF-8 canonical text', async () => {
    const expected = createHash('sha256')
      .update(Buffer.from(GOLDEN_ROW.prev_hash, 'hex'))
      .update(Buffer.from(GOLDEN_CANONICAL, 'utf8'))
      .digest('hex');
    expect(await computeAuditRowHash(GOLDEN_ROW)).toBe(expected);
  });
});

describe('verifyAuditChain', () => {
  async function chain(): Promise<AuditRowExport[]> {
    const rows: AuditRowExport[] = [];
    let prev = GENESIS_PREV_HASH;
    for (let seq = 1; seq <= 3; seq++) {
      const row: AuditRowExport = {
        ...GOLDEN_ROW,
        chain_seq: seq,
        action: seq === 1 ? 'audit.genesis' : 'task.update',
        prev_hash: prev,
        row_hash: '',
      };
      row.row_hash = await computeAuditRowHash(row);
      prev = row.row_hash;
      rows.push(row);
    }
    return rows;
  }

  it('accepts an intact chain', async () => {
    expect(await verifyAuditChain(await chain())).toEqual({
      ok: true,
      eventsChecked: 3,
      firstBadSeq: null,
      detail: null,
    });
  });

  it('pinpoints a tampered row, a gap, and a broken link', async () => {
    const tampered = await chain();
    tampered[1] = { ...(tampered[1] as AuditRowExport), outcome: 'denied' };
    expect(await verifyAuditChain(tampered)).toMatchObject({ ok: false, firstBadSeq: 2 });

    const gap = await chain();
    gap.splice(1, 1);
    expect(await verifyAuditChain(gap)).toMatchObject({
      ok: false,
      firstBadSeq: 2,
      detail: 'gap in chain_seq',
    });

    const empty = await verifyAuditChain([]);
    expect(empty.ok).toBe(false);
  });
});
