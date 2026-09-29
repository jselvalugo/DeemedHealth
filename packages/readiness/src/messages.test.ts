import { messages } from '@deemed/i18n';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { FX_CAT_ENTRIES } from '@deemed/test-fixtures/catalog';
import { parse as parseYaml } from 'yaml';
import { INTERNAL_LABEL, PARAM_LABELS_EN, REASON_TEMPLATES, reason } from './messages.js';
import { READINESS_STATUSES } from './types.js';

const en = messages.en as Record<string, string>;
const es = messages.es as Record<string, string>;
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('readiness strings (EN/ES)', () => {
  it('has an EN string equal to each reason template and an ES string with the same placeholders', () => {
    for (const [code, template] of Object.entries(REASON_TEMPLATES)) {
      const key = `readiness.reason.${code}`;
      expect(en[key], key).toBe(template);
      expect(es[key], key).toBeTruthy();
      expect(vars(es[key] as string), key).toEqual(vars(template));
    }
  });

  it('names coded parameter values through message keys in EN and ES, never raw codes (F14)', () => {
    for (const [key, label] of Object.entries(PARAM_LABELS_EN)) {
      expect(en[key], key).toBe(label);
      expect(es[key], key).toBeTruthy();
    }
    const r = reason('outside_applicability', { dimension: 'staffTypes' });
    expect(r.paramKeys).toEqual({ dimension: 'readiness.dimension.staffTypes' });
    expect(r.message).toContain('(staff type)');
    expect(r.message).not.toContain('staffTypes');
    const cap = reason('approval_capacity_insufficient', {
      required: 'board_or_committee_ratified',
    });
    expect(cap.message).not.toContain('board_or_committee_ratified');
    const odd = reason('tenant_parameter_unset', { parameter: 'madeUpKey', min: 1, max: 2 });
    expect(odd.paramKeys).toEqual({ parameter: 'readiness.parameter.unknown' });
    expect(odd.message).not.toContain('madeUpKey');
  });

  it('has a label for every tenant parameter in the fixtures and the draft catalog', () => {
    const dir = new URL('../../requirements-catalog/entries/', import.meta.url);
    const raw = readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .map(
        (f) =>
          parseYaml(readFileSync(new URL(f, dir), 'utf8')) as {
            parameters?: { tenantParameters?: object };
          },
      );
    const fixtures = Object.values(FX_CAT_ENTRIES) as {
      parameters?: { tenantParameters?: object };
    }[];
    for (const e of [...raw, ...fixtures]) {
      for (const name of Object.keys(e.parameters?.tenantParameters ?? {})) {
        expect(en[`readiness.parameter.${name}`], name).toBeTruthy();
      }
    }
  });

  it('labels every status and every authority as internal readiness in both languages', () => {
    for (const s of READINESS_STATUSES) {
      expect(en[`readiness.status.${s}`]).toBeTruthy();
      expect(es[`readiness.status.${s}`]).toBeTruthy();
    }
    for (const [authority, text] of Object.entries(INTERNAL_LABEL)) {
      expect(en[`readiness.label.${authority}`]).toBe(text);
      expect(es[`readiness.label.${authority}`]).toMatch(/no es una determinación de HRSA/);
    }
  });
});
