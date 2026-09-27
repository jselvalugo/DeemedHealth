import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Image from 'next/image';
import Link from 'next/link';
import { isProduction } from '@deemed/domain';
import { t, toLocale } from '@deemed/i18n';
import { LanguageToggle } from './language-toggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'Deemed Health',
  description: 'FQHC Compliance Software',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = toLocale((await cookies()).get('dh_lang')?.value);
  // Safe default (ADR-0005 §5): anything but exactly "production" shows the banner.
  const showPreview = !isProduction(process.env.DH_ENV);

  return (
    <html lang={locale}>
      <body className="min-h-screen font-sans">
        {showPreview && (
          <div
            role="status"
            className="bg-preview-bg text-preview-fg px-4 py-2 text-center text-sm font-semibold"
          >
            {t(locale, 'preview.banner')}
          </div>
        )}
        <header className="border-gray-200 bg-white flex h-16 items-center justify-between border-b px-4 md:px-8">
          <Link href="/" aria-label={t(locale, 'header.home')}>
            <Image
              src="/deemed-health-logo.png"
              alt="Deemed Health"
              width={63}
              height={32}
              priority
            />
          </Link>
          <LanguageToggle locale={locale} label={t(locale, 'language.label')} />
        </header>
        <nav
          aria-label={t(locale, 'moduleBar.label')}
          className="bg-navy-900 text-white/80 flex h-14 items-center px-4 text-sm md:px-8"
        >
          {t(locale, 'moduleBar.placeholder')}
        </nav>
        <main className="px-4 py-8 md:px-8">{children}</main>
      </body>
    </html>
  );
}
