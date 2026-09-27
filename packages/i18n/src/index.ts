// EN/ES message catalogs. English is the default locale (ADR-0001, FL-D1).
export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'preview.banner': 'PREVIEW · Synthetic data only. Do not enter real patient information.',
  'landing.title': 'Deemed Health — FQHC Compliance Software',
  'landing.subtitle': 'Development preview',
  'header.home': 'Deemed Health home',
  'language.label': 'Language',
  'moduleBar.label': 'Modules',
  'moduleBar.placeholder': 'Modules will appear here.',
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  'preview.banner':
    'VISTA PREVIA · Solo datos sintéticos. No ingrese información real de pacientes.',
  'landing.title': 'Deemed Health — Software de cumplimiento para FQHC',
  'landing.subtitle': 'Vista previa de desarrollo',
  'header.home': 'Inicio de Deemed Health',
  'language.label': 'Idioma',
  'moduleBar.label': 'Módulos',
  'moduleBar.placeholder': 'Los módulos aparecerán aquí.',
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en, es };

export function toLocale(value: string | undefined): Locale {
  return value === 'es' ? 'es' : DEFAULT_LOCALE;
}

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
