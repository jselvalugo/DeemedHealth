'use client';

import { useRouter } from 'next/navigation';
import { LOCALES, type Locale } from '@deemed/i18n';
import { cn } from '@deemed/ui';
import { setLocaleCookie } from '../lib/locale-client';

const LABELS: Record<Locale, { short: string; name: string }> = {
  en: { short: 'EN', name: 'English' },
  es: { short: 'ES', name: 'Español' },
};

export function LanguageToggle({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();

  function choose(next: Locale) {
    setLocaleCookie(next);
    router.refresh();
  }

  return (
    <div role="group" aria-label={label} className="flex rounded-control border border-gray-500">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          aria-label={LABELS[l].name}
          onClick={() => choose(l)}
          className={cn(
            'focus-ring min-h-10 min-w-10 px-3 text-sm first:rounded-l-control last:rounded-r-control',
            locale === l
              ? 'bg-navy-900 font-semibold text-white'
              : 'text-gray-700 hover:bg-gray-100',
          )}
        >
          {LABELS[l].short}
        </button>
      ))}
    </div>
  );
}
