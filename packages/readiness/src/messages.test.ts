import { messages } from '@deemed/i18n';
import { describe, expect, it } from 'vitest';
import { INTERNAL_LABEL, REASON_TEMPLATES } from './messages.js';
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
