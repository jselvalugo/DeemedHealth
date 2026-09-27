'use client';

import { useEffect, useRef } from 'react';
import { t } from '@deemed/i18n';
import { Alert, Button } from '@deemed/ui';
import { readLocaleCookie } from '../lib/locale-client';

/**
 * Shared error state. Shows no error details (they may carry data); the digest is
 * logged server-side by Next.js for correlation.
 */
export function ErrorView({ reset }: { reset: () => void }) {
  const locale = readLocaleCookie();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold text-navy-900 outline-none"
      >
        {t(locale, 'error.title')}
      </h1>
      <Alert tone="critical" title={t(locale, 'error.title')}>
        {t(locale, 'error.body')}
      </Alert>
      <div>
        <Button onClick={() => reset()}>{t(locale, 'error.retry')}</Button>
      </div>
    </div>
  );
}
