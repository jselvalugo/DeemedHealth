import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource/jetbrains-mono/500.css';
import { PreviewBanner } from '@deemed/ui';
import { t } from '@deemed/i18n';
import { getLocale } from '../lib/session';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: { default: 'Deemed Health', template: '%s · Deemed Health' },
    description: t(locale, 'app.tagline'),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        {/* Safe default (ADR-0005 §5): anything but exactly "production" shows the banner. */}
        <PreviewBanner env={process.env.DH_ENV} locale={locale} />
        {children}
      </body>
    </html>
  );
}
