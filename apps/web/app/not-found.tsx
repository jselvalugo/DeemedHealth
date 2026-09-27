import Link from 'next/link';
import { t } from '@deemed/i18n';
import { EmptyState, buttonClasses } from '@deemed/ui';
import { getLocale } from '../lib/session';

export default async function NotFound() {
  const locale = await getLocale();
  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-16">
      <EmptyState
        headingLevel={1}
        title={t(locale, 'notFound.title')}
        body={t(locale, 'notFound.body')}
        action={
          <Link href="/" className={buttonClasses()}>
            {t(locale, 'notFound.home')}
          </Link>
        }
      />
    </main>
  );
}
