/**
 * Every record type name and field label the registry derives has an English and a
 * Spanish string (ADR-0014 section 1; phase-1 plan S4b: "every record.<type>.field.<field>
 * key in the registry"), and there are no label keys for fields that do not exist.
 */
import { fieldLabelKey, recordNameKey, recordTypes } from '@deemed/domain';
import { messages } from '@deemed/i18n';
import { describe, expect, it } from 'vitest';

describe('record labels', () => {
  const keys = recordTypes().flatMap((def) => [
    recordNameKey(def.id),
    ...Object.keys(def.fields).map((f) => fieldLabelKey(def.id, f)),
  ]);

  it('exist in English and Spanish for every record type and field', () => {
    const en = messages.en as Record<string, string>;
    const es = messages.es as Record<string, string>;
    expect(keys.filter((k) => !en[k]?.trim())).toEqual([]);
    expect(keys.filter((k) => !es[k]?.trim())).toEqual([]);
  });

  it('name no field that the registry does not declare', () => {
    const declared = new Set(keys);
    const stray = Object.keys(messages.en).filter(
      (k) => k.startsWith('record.') && !declared.has(k),
    );
    expect(stray).toEqual([]);
  });
});
