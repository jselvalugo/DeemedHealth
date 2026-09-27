import { t } from '@deemed/i18n';
import { getLocale } from '../../lib/session';

/** Loading state for shell pages: a skeleton of the module home layout. */
export default async function AppLoading() {
  const locale = await getLocale();
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <p role="status" className="sr-only">
        {t(locale, 'loading.label')}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
        <div className="h-3 w-48 rounded-control bg-gray-100" />
        <div className="h-9 w-80 max-w-full rounded-control bg-gray-100" />
        <div className="h-5 w-[36rem] max-w-full rounded-control bg-gray-100" />
      </div>
      <div
        aria-hidden="true"
        className="grid gap-4 rounded-card bg-gray-25 p-6 motion-safe:animate-pulse sm:grid-cols-2 xl:grid-cols-5"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-36 rounded-card border border-gray-200 bg-white" />
        ))}
      </div>
    </div>
  );
}
