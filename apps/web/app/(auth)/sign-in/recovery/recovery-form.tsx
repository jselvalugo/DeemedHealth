'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { t, type Locale } from '@deemed/i18n';
import { Button, Card, Input, textLinkClasses } from '@deemed/ui';
import { ERROR_MESSAGES, IDLE, fieldError, type AuthFormState } from '../../../../lib/auth-types';
import { FormError, SignInHeading, useFocusOnError } from '../form-bits';

type Action = (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;

/** Account recovery: a saved recovery code, or guidance to ask an administrator (ADR-0006 §11). */
export function RecoveryForm({ locale, action }: { locale: Locale; action: Action }) {
  const tr = (k: Parameters<typeof t>[1], v?: Parameters<typeof t>[2]) => t(locale, k, v);
  const [state, formAction, pending] = useActionState(action, IDLE);
  const emailRef = useFocusOnError(state, 'email');
  const codeRef = useFocusOnError(state, 'code');
  const emailErr = fieldError(state, 'email');
  const codeErr = fieldError(state, 'code');

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6 sm:p-8">
        <SignInHeading title={tr('recovery.title')} body={tr('recovery.body')} />
        <form action={formAction} noValidate>
          <div className="flex flex-col gap-4">
            <FormError state={state} locale={locale} />
            <Input
              ref={emailRef}
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              label={tr('recovery.email.label')}
              error={emailErr ? tr(ERROR_MESSAGES[emailErr]) : undefined}
              required
            />
            <Input
              ref={codeRef}
              id="recovery-code"
              name="code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="[&_input]:font-mono"
              label={tr('recovery.code.label')}
              hint={tr('recovery.code.hint')}
              error={codeErr ? tr(ERROR_MESSAGES[codeErr]) : undefined}
              required
            />
            <Button type="submit" fullWidth loading={pending} loadingLabel={tr('mfa.verifying')}>
              {tr('recovery.submit')}
            </Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="recovery-admin" className="rounded-card bg-gray-25 p-6">
        <h2 id="recovery-admin" className="font-semibold text-navy-900">
          {tr('recovery.admin.title')}
        </h2>
        <p className="mt-1 text-sm text-gray-700">{tr('recovery.admin.body')}</p>
        <h2 className="mt-4 font-semibold text-navy-900">{tr('recovery.password.title')}</h2>
        <p className="mt-1 text-sm text-gray-700">{tr('recovery.password.body')}</p>
      </section>

      <p className="text-center text-sm">
        <Link href="/sign-in" className={textLinkClasses}>
          {tr('recovery.back')}
        </Link>
      </p>
    </div>
  );
}
