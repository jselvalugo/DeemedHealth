import { t } from '@deemed/i18n';
import { Card } from '@deemed/ui';
import { getLocale } from '../../../lib/session';

/** Loading state for every sign-in step. */
export default async function SignInLoading() {
  const locale = await getLocale();
  return (
    <Card className="p-6 sm:p-8" aria-busy="true">
      <p role="status" className="sr-only">
        {t(locale, 'loading.label')}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-4 motion-safe:animate-pulse">
        <div className="mx-auto h-7 w-2/3 rounded-control bg-gray-100" />
        <div className="h-4 w-1/3 rounded-control bg-gray-100" />
        <div className="h-10 rounded-control bg-gray-100" />
        <div className="h-10 rounded-control bg-gray-200" />
      </div>
    </Card>
  );
}
