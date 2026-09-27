'use client';

import { useEffect, useRef } from 'react';
import type { Locale } from '@deemed/i18n';
import { t } from '@deemed/i18n';
import { Alert } from '@deemed/ui';
import { formError, type AuthFormState } from '../../../lib/auth-types';

/** Form-level error (wrong credentials, locked, not implemented) announced as an alert. */
export function FormError({ state, locale }: { state: AuthFormState; locale: Locale }) {
  const key = formError(state);
  if (!key) return null;
  const tone = state.status === 'not_implemented' ? 'warn' : 'critical';
  return (
    <Alert tone={tone} title={t(locale, 'signIn.error.title')}>
      {t(locale, key)}
    </Alert>
  );
}

/** Move focus to the first invalid field after a failed submit. */
export function useFocusOnError(state: AuthFormState, field: string) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status === 'error' && state.field === field) ref.current?.focus();
  }, [state, field]);
  return ref;
}

export function SignInHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
      {body && <p className="mt-2 text-gray-700">{body}</p>}
    </div>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-sm text-gray-500">
      <span aria-hidden="true" className="h-px flex-1 bg-gray-200" />
      {label}
      <span aria-hidden="true" className="h-px flex-1 bg-gray-200" />
    </div>
  );
}
