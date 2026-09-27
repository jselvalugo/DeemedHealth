import Image from 'next/image';
import type { ReactNode } from 'react';
import { t } from '@deemed/i18n';
import { LanguageToggle } from '../../language-toggle';
import { getLocale } from '../../../lib/session';

/** White canvas, logo, and language switch for every sign-in step. */
export default async function SignInLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <div className="flex flex-1 flex-col bg-white">
      <div className="flex justify-end px-4 pt-4 md:px-8">
        <LanguageToggle locale={locale} label={t(locale, 'language.label')} />
      </div>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:pt-10">
        <div className="w-full max-w-md">
          <Image
            src="/brand/deemed-health-logo.png"
            alt={`${t(locale, 'app.name')}, ${t(locale, 'app.tagline')}`}
            width={1450}
            height={485}
            priority
            className="mx-auto h-16 w-auto"
          />
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
