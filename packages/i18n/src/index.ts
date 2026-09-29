// EN/ES message catalogs. English is the default locale (ADR-0001, FL-D1).
import { en } from './en.js';
import { es } from './es.js';
import { commandCenterEn } from './command-center.en.js';
import { commandCenterEs } from './command-center.es.js';
import { modulesEn } from './modules.en.js';
import { modulesEs } from './modules.es.js';
import { recordsEn } from './records.en.js';
import { recordsEs } from './records.es.js';
import { recordsUiEn } from './records-ui.en.js';
import { recordsUiEs } from './records-ui.es.js';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const enAll = { ...en, ...modulesEn, ...recordsEn, ...recordsUiEn, ...commandCenterEn };

export type MessageKey = keyof typeof enAll;
/** Alias used by the module registry (docs/product/module-map.md "Registry entry shape"). */
export type I18nKey = MessageKey;

export const messages: Record<Locale, Record<MessageKey, string>> = {
  en: enAll,
  es: { ...es, ...modulesEs, ...recordsEs, ...recordsUiEs, ...commandCenterEs },
};

export type MessageVars = Readonly<Record<string, string | number>>;

export function toLocale(value: string | undefined): Locale {
  return value === 'es' ? 'es' : DEFAULT_LOCALE;
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(enAll, value);
}

/** Look up a message and fill `{name}` placeholders. Unknown placeholders are left as is. */
export function t(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const text = messages[locale][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Message keys that have `.one` and `.other` plural forms. */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one`
    ? `${B}.other` extends MessageKey
      ? B
      : never
    : never;
}[MessageKey];

/** Pluralized message with `{count}` filled. EN and ES both use one/other. */
export function tCount(locale: Locale, base: PluralBase, count: number): string {
  const form = new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other';
  return t(locale, `${base}.${form}` as MessageKey, { count });
}

/** Bind a locale so components can call `tr(key, vars)`. */
export function translator(locale: Locale) {
  return (key: MessageKey, vars?: MessageVars) => t(locale, key, vars);
}
export type Translate = ReturnType<typeof translator>;
