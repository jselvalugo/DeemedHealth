import { cookies } from 'next/headers';
import { t, toLocale } from '@deemed/i18n';

export default async function HomePage() {
  const locale = toLocale((await cookies()).get('dh_lang')?.value);
  return (
    <section>
      <h1 className="text-navy-900 text-3xl font-semibold">{t(locale, 'landing.title')}</h1>
      <p className="text-gray-500 mt-2 text-lg">{t(locale, 'landing.subtitle')}</p>
    </section>
  );
}
