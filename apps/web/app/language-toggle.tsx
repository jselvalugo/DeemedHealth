'use client';

import { useRouter } from 'next/navigation';
import type { Locale } from '@deemed/i18n';

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
];

export function LanguageToggle({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();

  function choose(next: Locale) {
    document.cookie = `dh_lang=${next}; path=/; max-age=31536000; samesite=lax; secure`;
    router.refresh();
  }

  return (
    <div role="group" aria-label={label} className="border-gray-200 flex rounded-md border">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={locale === o.value}
          onClick={() => choose(o.value)}
          className={
            locale === o.value
              ? 'bg-navy-900 text-white px-3 py-1 text-sm font-semibold'
              : 'text-gray-700 px-3 py-1 text-sm'
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
